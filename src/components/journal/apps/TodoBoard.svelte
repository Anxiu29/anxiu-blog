<script lang="ts">
 import { onMount, tick } from 'svelte';
 import AppIcon from './AppIcon.svelte';
 import { createTodoStore, localDay, makeBackup, MAX_BACKUP_BYTES, mergeTasks, parseBackup, selectTasks, TASK_STORAGE_KEY, TodoError, type Task, type TaskFilter, type TodoStore } from '@/scripts/todo-store';
 import '@/styles/journal-todo.css';
 let { compact=false }: {compact?:boolean}=$props();
 let store:TodoStore;
 let tasks:Task[]=$state([]);
 let ready=$state(false);
 let busy=$state(false);
 let title=$state('');
 let due=$state('');
 let priority=$state<Task['priority']>('normal');
 let filter=$state<TaskFilter>('active');
 let query=$state('');
 let today=$state(localDay());
 let message=$state('');
 let messageError=$state(false);
 let loadError=$state('');
 let corrupt=$state(false);
 let hasRecovery=$state(false);
 let pendingRecovery=$state(false);
 let editing=$state('');
 let editTitle=$state('');
 let editDue=$state('');
 let editPriority=$state<Task['priority']>('normal');
 let pendingImport:Task[]|null=$state(null);
 let importSummary=$state({added:0,updated:0,kept:0});
 let importName=$state('');
 let fileInput:HTMLInputElement;
 let boardElement:HTMLDivElement;
 const prefix=$derived(compact?'quick-task':'full-task');
 const active=$derived(tasks.filter(t=>!t.done&&!t.deletedAt));
 const completed=$derived(tasks.filter(t=>t.done&&!t.deletedAt));
 const trashed=$derived(tasks.filter(t=>!!t.deletedAt));
 const overdue=$derived(active.filter(t=>t.due&&t.due<today));
 const visible=$derived(selectTasks(tasks,compact?'active':filter,compact?'':query));
 const tabs=$derived([{value:'active',label:'进行中',count:active.length},{value:'all',label:'全部',count:active.length+completed.length},{value:'done',label:'已完成',count:completed.length},{value:'trash',label:'回收站',count:trashed.length}]);
 function readable(error:unknown){return error instanceof TodoError?error.message:'操作未完成，请重试。原有待办没有被清空。';}
 function say(text:string,error=false){message=text;messageError=error;}
 function load(){
  try{tasks=store.read();hasRecovery=store.readRecovery()!==null;loadError='';corrupt=false;}
  catch(error){loadError=readable(error);corrupt=error instanceof TodoError&&error.code==='corrupt';}
  today=localDay();ready=true;
 }
 onMount(()=>{
  store=createTodoStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)}, {
   exclusive:operation=>navigator.locks?navigator.locks.request(TASK_STORAGE_KEY,operation):Promise.resolve().then(operation),
   notify:()=>window.dispatchEvent(new Event('anxiu:tasks-updated')),
  });
  load();
  const sync=(event:StorageEvent)=>{if(event.key===null||event.key===TASK_STORAGE_KEY)load();};
  const resume=()=>{if(!document.hidden)load();};
  const timer=setInterval(()=>today=localDay(),60_000);
  window.addEventListener('storage',sync);window.addEventListener('anxiu:tasks-updated',load);window.addEventListener('pageshow',load);document.addEventListener('visibilitychange',resume);
  return()=>{clearInterval(timer);window.removeEventListener('storage',sync);window.removeEventListener('anxiu:tasks-updated',load);window.removeEventListener('pageshow',load);document.removeEventListener('visibilitychange',resume);};
 });
 async function write(operation:()=>Promise<Task[]>,success:string|(()=>string),allowRecovery=false){
  if(!ready||busy||(loadError&&!allowRecovery))return false;
  const previousFocus=document.activeElement;
  busy=true;
  try{tasks=await operation();say(typeof success==='function'?success():success);return true;}
  catch(error){if(error instanceof TodoError&&error.code==='corrupt')load();say(readable(error),true);return false;}
  finally{busy=false;await tick();if(previousFocus instanceof HTMLElement&&document.activeElement===document.body){const target=previousFocus.isConnected&&!previousFocus.matches(':disabled')?previousFocus:boardElement?.querySelector<HTMLElement>('.todo-filters [aria-pressed=true]')||boardElement?.querySelector<HTMLElement>('.todo-add input:not(:disabled), .todo-load-error button');target?.focus();}}
 }
 async function add(event:SubmitEvent){
  event.preventDefault();
  if(await write(()=>store.add({title,due:compact?'':due,priority:compact?'normal':priority}),'已保存这条待办。')){title='';due='';priority='normal';}
 }
 async function changeDone(event:Event,task:Task){
  const box=event.currentTarget as HTMLInputElement;
  const done=box.checked;
  if(!await write(()=>store.setDone(task.id,done),done?'已标记完成。':'已恢复为进行中。'))box.checked=tasks.find(t=>t.id===task.id)?.done??task.done;
 }
 async function beginEdit(task:Task){editing=task.id;editTitle=task.title;editDue=task.due;editPriority=task.priority;await tick();boardElement.querySelector<HTMLTextAreaElement>('#edit-task-title')?.focus();}
 async function cancelEdit(){const row=boardElement.querySelector('#edit-task-title')?.closest('li');editing='';await tick();row?.querySelector<HTMLButtonElement>('.todo-row-actions button')?.focus();}
 async function finishEdit(event:SubmitEvent){event.preventDefault();const row=(event.currentTarget as HTMLFormElement).closest('li');if(await write(()=>store.update(editing,{title:editTitle,due:editDue,priority:editPriority}),'修改已保存。')){editing='';await tick();row?.querySelector<HTMLButtonElement>('.todo-row-actions button')?.focus();}}
 function download(text:string,name:string,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function backup(){try{download(makeBackup(store.read()),`安秀待办-${localDay()}.json`);say('已生成备份文件，请留意浏览器下载。');}catch(error){say(readable(error),true);}}
 function rawBackup(){try{download(store.readRaw(),`安秀待办-原始数据-${localDay()}.txt`,'text/plain');say('已下载原始数据，当前存储未改变。');}catch(error){say(readable(error),true);}}
 function recoveryBackup(){try{const raw=store.readRecovery();if(raw===null)throw new TodoError('没有可下载的修复前数据。');download(raw,`安秀待办-修复前数据-${localDay()}.txt`,'text/plain');say('已下载修复前的原始数据。');}catch(error){say(readable(error),true);}}
 async function inspectBackup(event:Event){
  const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;
  pendingImport=null;
  try{if(file.size>MAX_BACKUP_BYTES)throw new TodoError('备份文件不能超过 16 MB。');const imported=parseBackup(await file.text());pendingRecovery=corrupt;const preview=corrupt?{added:imported.length,updated:0,kept:0}:mergeTasks(store.read(),imported);importSummary={added:preview.added,updated:preview.updated,kept:preview.kept};pendingImport=imported;importName=file.name;say('备份已读取，请核对预览。');}
  catch(error){say(readable(error),true);}
  input.value='';
 }
 async function commitImport(){
  const incoming=pendingImport;if(!incoming)return;
  let summary='';
  const saved=await write(async()=>{if(pendingRecovery){const tasks=await store.recover(incoming);summary=`已从备份恢复 ${tasks.length} 条待办，修复前的数据已另存，可随时下载。`;return tasks;}const result=await store.import(incoming);summary=`已合并：新增 ${result.added} 条，更新 ${result.updated} 条，保留 ${result.kept} 条较新或相同的本地记录。`;return result.tasks;},()=>summary,pendingRecovery);
  if(saved){pendingImport=null;editing='';await tick();boardElement.querySelector<HTMLInputElement>('.todo-add>input')?.focus();}
 }
</script>

<div class:compact class="todo-board" data-todo-app data-pagefind-ignore aria-busy={busy} bind:this={boardElement}>
 {#if !compact}
  <header class="todo-heading"><div><p class="todo-eyebrow">一件一件，慢慢来</p><h2>把今天，慢慢做好。</h2><p>{ready?`还有 ${active.length} 件事等待完成。`:'正在读取这个浏览器的待办…'}</p></div><span class="todo-heading-icon" aria-hidden="true"><AppIcon name="check" size={30}/></span></header>
  <div class="todo-summary"><div><strong>{ready?active.length:'—'}</strong><span>进行中</span></div><div><strong>{ready?completed.length:'—'}</strong><span>已完成</span></div><div class:has-overdue={overdue.length>0}><strong>{ready?overdue.length:'—'}</strong><span>已逾期</span></div></div>
 {/if}
 {#if loadError}<div class="todo-load-error" role="alert"><strong>暂时无法读取待办</strong><p>{loadError}</p><div><button type="button" class="td-button secondary" onclick={load}>重试读取</button>{#if corrupt&&!compact}<button type="button" class="td-button secondary" onclick={rawBackup}>下载原始数据</button>{/if}</div>{#if compact}<a href="/todo/">到完整页面处理</a>{/if}</div>{/if}
 <form class="todo-add" onsubmit={add}>
  <label class="sr-only" for={`${prefix}-title`}>新增待办</label><input id={`${prefix}-title`} bind:value={title} maxlength="300" placeholder={compact?'记下一件小事…':'今天有什么想做的？'} required disabled={!ready||busy||!!loadError} autocomplete="off"/>
  {#if !compact}<div class="todo-add-options"><label for="task-due">截止日期<input id="task-due" type="date" bind:value={due} max="9999-12-31" disabled={busy||!!loadError}/></label><label for="task-priority">优先级<select id="task-priority" bind:value={priority} disabled={busy||!!loadError}><option value="normal">普通</option><option value="high">重要</option></select></label></div>{/if}
  <button type="submit" class="td-button primary" aria-label="添加待办" disabled={!ready||busy||!!loadError}><AppIcon name="plus" size={20}/>{#if !compact}<span>添加待办</span>{/if}</button>
 </form>
 {#if !compact}
  <div class="todo-toolbar"><div class="todo-filters" role="group" aria-label="待办筛选">{#each tabs as tab}<button type="button" aria-pressed={filter===tab.value} onclick={()=>{filter=tab.value as TaskFilter;editing='';}}>{tab.label}<small>{ready?tab.count:'—'}</small></button>{/each}</div><label class="todo-search"><AppIcon name="search" size={17}/><input type="search" bind:value={query} placeholder="搜索待办" aria-label="搜索待办"/></label></div>
  {#if filter==='trash'}<p class="todo-list-note">这里的任务可以恢复，原来的完成状态也会保留。</p>{:else}<p class="todo-list-note">进行中优先 · 重要优先 · 截止日期由近到远</p>{/if}
 {/if}
 <ul class="todo-items" aria-label={compact?'最近的进行中待办':'待办列表'}>
  {#each (compact?visible.slice(0,3):visible) as task (task.id)}
   <li class:done={task.done} class:important={task.priority==='high'}>
    {#if task.deletedAt}<span class="todo-trash-icon"><AppIcon name="trash" size={18}/></span>{:else}<input class="todo-checkbox" type="checkbox" checked={task.done} onchange={event=>changeDone(event,task)} disabled={busy||!!loadError} aria-label={`${task.done?'恢复为进行中':'完成'}：${task.title}`}/>{/if}
    <div class="todo-item-main">
     {#if editing===task.id&&!compact}
      <form class="todo-edit" onsubmit={finishEdit}>
       <label class="sr-only" for="edit-task-title">修改待办内容</label><textarea id="edit-task-title" bind:value={editTitle} maxlength="300" rows="2" required disabled={busy} onkeydown={event=>{if(event.key==='Escape'){event.preventDefault();void cancelEdit();}}}></textarea>
       <div class="todo-edit-options"><label for="edit-task-due">截止日期<input id="edit-task-due" type="date" bind:value={editDue} max="9999-12-31" disabled={busy}/></label><label for="edit-task-priority">优先级<select id="edit-task-priority" bind:value={editPriority} disabled={busy}><option value="normal">普通</option><option value="high">重要</option></select></label></div>
       <div class="todo-edit-actions"><button type="submit" class="td-button primary" disabled={busy}>保存修改</button><button type="button" class="td-button secondary" onclick={cancelEdit} disabled={busy}>取消修改</button></div>
      </form>
     {:else}<span class="todo-item-title">{task.title}</span><div class="todo-item-meta">{#if task.priority==='high'}<span class="todo-important-label"><AppIcon name="star" size={12}/>重要</span>{/if}{#if task.due&&!compact}<time datetime={task.due} class:overdue={!task.done&&!task.deletedAt&&task.due<today}><AppIcon name="calendar" size={13}/>{task.due}{!task.done&&!task.deletedAt&&task.due<today?' · 已逾期':''}</time>{/if}</div>{/if}
    </div>
    {#if !compact&&editing!==task.id}<div class="todo-row-actions">{#if task.deletedAt}<button type="button" class="td-icon-button" aria-label={`从回收站恢复：${task.title}`} onclick={()=>write(()=>store.restore(task.id),'已从回收站恢复。')} disabled={busy||!!loadError}><AppIcon name="restore" size={18}/></button>{:else}<button type="button" class="td-icon-button" aria-label={`编辑：${task.title}`} onclick={()=>beginEdit(task)} disabled={busy||!!loadError}><AppIcon name="edit" size={17}/></button><button type="button" class="td-icon-button" aria-label={`移入回收站：${task.title}`} onclick={()=>write(()=>store.trash(task.id),'已移入回收站，可随时恢复。')} disabled={busy||!!loadError}><AppIcon name="trash" size={17}/></button>{/if}</div>{/if}
   </li>
  {/each}
 </ul>
 {#if ready&&!loadError&&!visible.length}<div class="todo-empty"><span aria-hidden="true"><AppIcon name={filter==='trash'?'trash':query?'search':'check'} size={compact?24:32}/></span><h3>{query?'没有匹配的待办':filter==='done'?'完成的事情，会留在这里':filter==='trash'?'回收站是空的':'留一件小事给今天'}</h3><p>{query?'试试其他关键词，或清空搜索。':filter==='trash'?'移入回收站的任务，都能在这里找回。':compact?'想到了，就记下来。':'从上面的输入框开始，不用一次做完所有事。'}</p></div>{/if}
 {#if !compact&&ready&&((filter==='done'&&completed.length)||(filter==='trash'&&trashed.length))}<div class="todo-bulk"><button class="td-button secondary" type="button" disabled={busy||!!loadError} onclick={()=>filter==='trash'?write(()=>store.restoreTrash(),'回收站的待办已全部恢复。'):write(()=>store.trashCompleted(),'已完成的待办已移入回收站，可随时恢复。')}>{filter==='trash'?`恢复回收站全部（${trashed.length} 条）`:`将全部已完成移入回收站（${completed.length} 条）`}</button></div>{/if}
 {#if compact}<a class="todo-full-link" href="/todo/">管理全部待办 <span>{ready?`${active.length} 件进行中`:'正在读取'}</span></a>{:else}
  {#if pendingImport}<section class="todo-import-preview" aria-labelledby="todo-import-heading"><h3 id="todo-import-heading">{pendingRecovery?'从备份恢复待办':'核对这次合并'}</h3><p class="todo-import-file">{importName} · {pendingImport.length} 条记录</p>{#if !pendingRecovery}<ul><li>新增 {importSummary.added} 条</li><li>更新 {importSummary.updated} 条较旧的本地记录</li><li>保留 {importSummary.kept} 条较新或相同的本地记录</li></ul><p>不会清空原有待办。合并时会再次核对最新数据。</p>{:else}<p>本地数据无法读取，将使用这份备份重建待办。修复前的原始数据会另存，恢复后仍可下载。</p>{/if}<div><button type="button" class="td-button primary" onclick={commitImport} disabled={busy||(!pendingRecovery&&!!loadError)}>{pendingRecovery?'另存原数据并恢复待办':'确认合并备份'}</button><button type="button" class="td-button secondary" onclick={()=>pendingImport=null} disabled={busy}>取消导入</button></div></section>{/if}
  <footer class="todo-footer"><div><strong><AppIcon name="shield" size={16}/>仅保存在当前浏览器</strong><p>不上传任务；换浏览器或换设备时，请先导出，再导入备份。</p></div><div class="todo-backup-actions"><button type="button" class="td-button secondary" onclick={backup} disabled={!ready||busy||!!loadError}><AppIcon name="download" size={16}/>导出备份</button><button type="button" class="td-button secondary" onclick={()=>fileInput.click()} disabled={!ready||busy||(!!loadError&&!corrupt)}><AppIcon name="upload" size={16}/>导入备份</button>{#if hasRecovery}<button type="button" class="td-button secondary" onclick={recoveryBackup} disabled={busy}>下载修复前数据</button>{/if}</div><input id="todo-import-file" hidden bind:this={fileInput} type="file" accept="application/json,.json" onchange={inspectBackup} aria-label="选择待办备份文件"/></footer>
 {/if}
 <p class="todo-message" class:error={messageError} role={messageError?'alert':'status'} aria-live="polite">{message}</p>
</div>
