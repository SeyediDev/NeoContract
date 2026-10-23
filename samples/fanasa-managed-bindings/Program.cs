using Npgsql;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<ProbeStorage>();
var app = builder.Build();

app.MapGet("/health/live", () => Results.Ok(new { alive = true }));
app.MapGet("/health/ready", async (ProbeStorage storage, CancellationToken ct) =>
{
    try
    {
        await storage.Check(ct);
        return Results.Ok(new { ready = true });
    }
    catch (Exception error) when (ProbeStorage.SafeFailure(error))
    {
        return Results.Json(new { ready = false }, statusCode: 503);
    }
});

app.MapPost("/acceptance/probes/{id:guid}", async (Guid id, ProbeStorage storage, CancellationToken ct) =>
{
    if (id == Guid.Empty) return Results.BadRequest();
    try
    {
        await storage.Write(id, ct);
        return Results.Ok(await storage.Read(id, ct));
    }
    catch (Exception error) when (ProbeStorage.SafeFailure(error))
    {
        return Results.Json(new { id, available = false }, statusCode: 503);
    }
});
app.MapGet("/acceptance/probes/{id:guid}", async (Guid id, ProbeStorage storage, CancellationToken ct) =>
{
    if (id == Guid.Empty) return Results.BadRequest();
    try { return Results.Ok(await storage.Read(id, ct)); }
    catch (Exception error) when (ProbeStorage.SafeFailure(error))
    {
        return Results.Json(new { id, available = false }, statusCode: 503);
    }
});
app.Run();

public sealed record ProbeResult(Guid Id, bool PostgreSqlReadBack, bool RedisReadBack);

public sealed class ProbeStorage(IConfiguration configuration) : IAsyncDisposable
{
    private NpgsqlDataSource? postgres;
    private ConnectionMultiplexer? redis;
    private readonly SemaphoreSlim initialization = new(1, 1);

    public static bool SafeFailure(Exception error) => error is NpgsqlException or RedisException
        or TimeoutException or OperationCanceledException or ArgumentException or InvalidOperationException;

    private async Task<(NpgsqlDataSource Pg, IDatabase Cache)> Clients(CancellationToken ct)
    {
        await initialization.WaitAsync(ct);
        try
        {
            var pgSetting = configuration.GetConnectionString("Database")
                ?? configuration["FanasaServices:database:ConnectionString"];
            var redisSetting = configuration["Redis:Configuration"]
                ?? configuration["FanasaServices:cache:ConnectionString"];
            if (string.IsNullOrWhiteSpace(pgSetting) || string.IsNullOrWhiteSpace(redisSetting))
                throw new InvalidOperationException("Managed bindings are required.");
            if (postgres is null)
            {
                var options = new NpgsqlConnectionStringBuilder(pgSetting)
                {
                    MaxPoolSize = 4, Timeout = 5, CommandTimeout = 5, IncludeErrorDetail = false
                };
                postgres = NpgsqlDataSource.Create(options.ConnectionString);
            }
            if (redis is null)
            {
                var options = ConfigurationOptions.Parse(redisSetting);
                options.ConnectTimeout = 3000;
                options.AsyncTimeout = 3000;
                options.ConnectRetry = 0;
                options.AbortOnConnectFail = false;
                // The shared multiplexer must finish initialization before releasing the lock.
                redis = await ConnectionMultiplexer.ConnectAsync(options);
            }
            return (postgres, redis.GetDatabase());
        }
        finally { initialization.Release(); }
    }

    public async Task Check(CancellationToken ct)
    {
        var (pg, cache) = await Clients(ct);
        await using var command = pg.CreateCommand("SELECT 1");
        await command.ExecuteScalarAsync(ct);
        await cache.PingAsync().WaitAsync(ct);
    }

    public async Task Write(Guid id, CancellationToken ct)
    {
        var (pg, cache) = await Clients(ct);
        await using (var schema = pg.CreateCommand("""
            CREATE TABLE IF NOT EXISTS fanasa_acceptance_probes (
                id uuid PRIMARY KEY, marker text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
            )
            """))
            await schema.ExecuteNonQueryAsync(ct);
        await using (var write = pg.CreateCommand("""
            INSERT INTO fanasa_acceptance_probes (id, marker) VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE SET marker = EXCLUDED.marker
            """))
        {
            write.Parameters.AddWithValue(id);
            write.Parameters.AddWithValue(Marker(id));
            await write.ExecuteNonQueryAsync(ct);
        }
        await cache.StringSetAsync(Key(id), Marker(id), TimeSpan.FromHours(24)).WaitAsync(ct);
    }

    public async Task<ProbeResult> Read(Guid id, CancellationToken ct)
    {
        var (pg, cache) = await Clients(ct);
        await using var read = pg.CreateCommand("SELECT marker FROM fanasa_acceptance_probes WHERE id = $1");
        read.Parameters.AddWithValue(id);
        var stored = await read.ExecuteScalarAsync(ct) as string;
        var cached = await cache.StringGetAsync(Key(id)).WaitAsync(ct);
        return new(id, stored == Marker(id), cached == Marker(id));
    }

    private static string Key(Guid id) => "fanasa:acceptance:" + id.ToString("N");
    private static string Marker(Guid id) => "probe-" + id.ToString("N");

    public async ValueTask DisposeAsync()
    {
        if (redis is not null) await redis.DisposeAsync();
        if (postgres is not null) await postgres.DisposeAsync();
        initialization.Dispose();
    }
}
