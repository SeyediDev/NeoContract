import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentSections,documentMatches,missingContractTerms,readinessHtml,documentReaderHtml} from '../public/contract-detail-ui.js';

test('outline keeps original offsets and duplicates, excludes code fences and unstructured prose',()=>{
 const text='# قرارداد\r\n\r\n## ماده ۱ ـ مبلغ ##\r\nمتن ماده ۲ و تعهدات\r\n```md\r\n## نمونه داخل کد\r\n````\r\n~~~\nپیوست 9: داخل کد\n~~~\nماده ۲ ـ تحویل\n## ماده ۱ ـ مبلغ\n    # کد تورفته\nپیوست ۳: <img onerror=bad()>\n###بدون فاصله';
 const sections=documentSections(text);
 assert.deepEqual(sections.map(s=>s.title),['قرارداد','ماده ۱ ـ مبلغ','ماده ۲ ـ تحویل','ماده ۱ ـ مبلغ','پیوست ۳: <img onerror=bad()>']);
 assert.ok(sections.every(s=>text.slice(s.start).startsWith(s.level===1?'# قرارداد':s.title.startsWith('پیوست')?'پیوست':s.title==='ماده ۲ ـ تحویل'?'ماده ۲':'## ماده')));
 const html=documentReaderHtml({document:text},'');
 assert.ok(html.includes('value="3">ماده ۱ ـ مبلغ'));
 assert.ok(html.includes('&lt;img onerror=bad()&gt;'));
 assert.ok(!html.includes('<img'));
 assert.ok(!documentReaderHtml({document:'متن بدون عنوان'},'').includes('data-document-section-select'));
});

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
