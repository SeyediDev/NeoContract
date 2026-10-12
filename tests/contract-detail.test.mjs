import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentMatches,missingContractTerms,readinessHtml,documentReaderHtml} from '../public/contract-detail-ui.js';

test('literal document search preserves Persian/Arabic offsets, digits and HTML-shaped text',()=>{
 const text='كیف ۱۲۳ · کیف 123 · API [a+b] <script> داده';
 const result=documentMatches(text,'کیف ١٢٣');
 assert.equal(result.matches.length,2);
 assert.deepEqual(result.matches.map(m=>text.slice(m.start,m.end)),['كیف ۱۲۳','کیف 123']);
 assert.equal(documentMatches(text,'[a+b]').matches.length,1);
 assert.equal(documentMatches(text,'api').matches.length,1);
 assert.equal(documentMatches(text,'<script>').matches.length,1);
 assert.equal(documentMatches(text,' ').matches.length,0);
 assert.equal(documentMatches(text,'ناموجود').matches.length,0);
 const many=documentMatches('بند '.repeat(301),'بند');
 assert.equal(many.matches.length,300);assert.equal(many.truncated,true);
});

test('proposals never fill agreed terms, while an agreed zero is a recorded amount',()=>{
 const c={party:'شرکت',amount:null,proposalRevision:{pricing:{total:72000000}},snapshot:{terms:{paymentTerms:'توافقی'}}};
 assert.deepEqual(missingContractTerms(c),['مبلغ توافقی','تاریخ شروع','تاریخ پایان']);
 assert.ok(!missingContractTerms({...c,amount:0}).includes('مبلغ توافقی'));
 assert.ok(missingContractTerms({...c,snapshot:{terms:{},services:[{code:'one'}]}}).includes('سطح خدمت اقلام'));
});

test('reader and readiness escape stored text and preserve the initial flags as a separate reference',()=>{
 const c={document:'<script>alert(1)</script>',snapshot:{intake:{confirmationFlags:['<img onerror=bad()>']}}};
 const html=documentReaderHtml(c,'');
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(!readinessHtml(c).includes('<img'));
 assert.ok(readinessHtml(c).includes('سند اولیه'));
 assert.ok(!readinessHtml(c).includes('open>'));
});
