USE [NeoContract];
GO
DECLARE @tenant uniqueidentifier='00000000-0000-0000-0000-000000000001';
IF NOT EXISTS(SELECT 1 FROM contracts.tenants WHERE id=@tenant) INSERT contracts.tenants(id,slug,name,settings) VALUES(@tenant,N'entekhab',N'گروه انتخاب',N'{"calendar":"jalali","currency":"IRR"}');
DECLARE @manager uniqueidentifier='5ee49fac-d467-5cd4-bd2e-a4c70c70de37';
IF NOT EXISTS(SELECT 1 FROM contracts.account_managers WHERE id=@manager) INSERT contracts.account_managers(id,tenant_id,manager_code,display_name,email,verification_status,metadata) VALUES(@manager,@tenant,N'AM-DEMO-01',N'اکانت‌منیجر نمونه ۱',N'manager1@example.invalid',N'demo-unverified',N'{"demo":true}');
IF NOT EXISTS(SELECT 1 FROM contracts.customers WHERE customer_code=N'CUS-DEMO-01' AND tenant_id=@tenant) INSERT contracts.customers(id,tenant_id,customer_code,legal_name,account_manager_id,unit,industry,verification_status,metadata) VALUES('b77a7aa8-f981-5a2e-826e-298434877c8d',@tenant,N'CUS-DEMO-01',N'هلدینگ نمونه',@manager,N'واحد نمونه',N'تولید',N'demo-unverified',N'{"demo":true}');
DECLARE @template uniqueidentifier='5a87460c-2d30-5432-81af-d9336a1bade0', @version uniqueidentifier='e7476b2e-4a8a-5f51-a97e-6c47a2aec09e';
IF NOT EXISTS(SELECT 1 FROM contracts.contract_templates WHERE id=@template) INSERT contracts.contract_templates(id,tenant_id,code,name,category,description,status,metadata,current_version_id) VALUES(@template,@tenant,N'msa',N'قرارداد مادر خدمات',N'خدمات',N'شرایط عمومی رابطه ارائه‌دهنده و مشتری',N'active',N'{"legal_approval":"not-approved"}',@version);
IF NOT EXISTS(SELECT 1 FROM contracts.contract_template_versions WHERE id=@version) INSERT contracts.contract_template_versions(id,tenant_id,template_id,version_no,body_template,variable_schema,process_config,status,published_at) VALUES(@version,@tenant,@template,1,N'قرارداد مادر خدمات\nنسخه نمایشی برای تدوین؛ این متن تصویب حقوقی نشده است.',N'{"fields":[{"key":"title","required":true},{"key":"party","required":true}]}',N'{"stages":[{"id":"legal","name":"بررسی حقوقی","role":"legal","slaDays":2,"required":true},{"id":"technical","name":"بررسی فنی","role":"technical","slaDays":2,"required":true},{"id":"finance","name":"بررسی مالی","role":"finance","slaDays":2,"required":true},{"id":"management","name":"تأیید مدیریت","role":"management","slaDays":1,"required":true},{"id":"sign","name":"امضای مجاز","role":"signatory","slaDays":3,"required":true}]}',N'published','2026-09-30');
IF NOT EXISTS(SELECT 1 FROM contracts.template_workflow_stages WHERE template_version_id=@version AND stage_key=N'legal') BEGIN
 INSERT contracts.template_workflow_stages(id,tenant_id,template_version_id,stage_key,name,sequence_no,required,role_key,sla_days) VALUES
 ('f582c302-252f-545c-8be6-3cabc471c722',@tenant,@version,N'legal',N'بررسی حقوقی',1,1,N'legal',2),
 ('25cb8dee-9a2c-534a-b3b3-7ef496c6dc33',@tenant,@version,N'technical',N'بررسی فنی',2,1,N'technical',2),
 ('92d125fa-cbdd-5cb2-a67c-5d96248ee283',@tenant,@version,N'finance',N'بررسی مالی',3,1,N'finance',2),
 ('57a02ea2-b144-5250-8e64-0639ea87dd4d',@tenant,@version,N'management',N'تأیید مدیریت',4,1,N'management',1),
 ('4b4c8eeb-d461-5373-ae27-16ad1b28f884',@tenant,@version,N'sign',N'امضای مجاز',5,1,N'signatory',3); END
IF NOT EXISTS(SELECT 1 FROM contracts.app_settings WHERE tenant_id=@tenant AND [key]=N'workspace') INSERT contracts.app_settings(tenant_id,[key],[value]) VALUES(@tenant,N'workspace',N'{"workspaceName":"گروه انتخاب","currency":"IRR","calendar":"jalali","contractPrefix":"NC"}');
IF NOT EXISTS(SELECT 1 FROM contracts.schema_migrations WHERE version=2) INSERT contracts.schema_migrations(version,name,checksum) VALUES(2,N'002_seed.sql',N'sqlserver-seed-v1');
GO
