type SearchRecord = {title:string;description:string;url:string;type:string;text:string};

// Both the full page and the dialog use the same escaped, static search records.
export function initializeJournalSearch() {
  const records:SearchRecord[]=JSON.parse(document.querySelector<HTMLElement>('#search-data')?.dataset.records||'[]');
  for(const root of document.querySelectorAll<HTMLElement>('[data-site-search]')) {
    const input=root.querySelector<HTMLInputElement>('input[type="search"]');
    const results=root.querySelector<HTMLElement>('[data-search-results]');
    const status=root.querySelector<HTMLElement>('[data-search-status]');
    if(!input||!results||!status)continue;
    const fullPage=root.hasAttribute('data-search-page');
    if(fullPage)input.value=new URLSearchParams(location.search).get('q')||'';
    function update() {
      if(!input||!results||!status)return;
      const query=input.value.trim();
      const terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matches=terms.length?records.map((r,index)=>{
        const title=r.title.toLocaleLowerCase();
        const description=r.description.toLocaleLowerCase();
        const text=(r.title+' '+r.description+' '+r.text).toLocaleLowerCase();
        return {record:r,index,match:terms.every(term=>text.includes(term)),score:terms.reduce((sum,term)=>sum+(title.includes(term)?3:description.includes(term)?1:0),0)};
      }).filter(r=>r.match).sort((a,b)=>b.score-a.score||a.index-b.index).map(r=>r.record):records.slice(0,4);
      const shown=fullPage?matches:matches.slice(0,12);
      status.textContent=terms.length?(matches.length?'找到 '+matches.length+' 个结果'+(shown.length<matches.length?'，显示前 '+shown.length+' 个。':'。'):'没有找到匹配内容，可以试试“WebHID”“待办”或“雾镇”。'):'可以从这些记录开始，或输入关键词搜索。';
      results.replaceChildren();
      for(const record of shown) {
        const li=document.createElement('li');
        const link=document.createElement('a');link.href=record.url;
        const title=document.createElement('strong');title.textContent=record.title;
        const description=document.createElement('span');description.textContent=record.type+' · '+record.description;
        link.append(title,description);li.append(link);results.append(li);
      }
      const expanded=document.querySelector<HTMLAnchorElement>('[data-full-search]');
      if(!fullPage&&expanded)expanded.href='/search/'+(query?'?q='+encodeURIComponent(query):'');
    }
    input.addEventListener('input',()=>{
      update();
      if(fullPage){const url=new URL(location.href);const query=input.value.trim();if(query)url.searchParams.set('q',query);else url.searchParams.delete('q');history.replaceState(null,'',url.pathname+url.search+url.hash);}
    });
    root.querySelector('form')?.addEventListener('submit',event=>event.preventDefault());
    update();
  }
}
