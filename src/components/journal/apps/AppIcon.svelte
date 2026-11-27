<script lang="ts">
 let {name,size=20}:{name:string;size?:number}=$props();
 const paths:Record<string,string[]>={
  plus:['M12 5v14M5 12h14'],close:['m6 6 12 12M6 18 18 6'],check:['m5 12 4 4L19 6'],
  trash:['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  edit:['m15 5 4 4M4 20l4-1L21 6l-5-5L3 14Z'],search:['m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  lock:['M5 10h14v11H5ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3'],image:['M3 3h18v18H3ZM3 16l6-6 5 5 3-3 4 4M8 7h.01'],
  upload:['M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6'],download:['M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6'],
  folder:['M3 5h7l2 3h9v13H3Z'],calendar:['M3 5h18v16H3ZM7 2v6m10-6v6M3 11h18'],
  previous:['m15 5-7 7 7 7'],next:['m9 5 7 7-7 7'],restore:['M3 11a9 9 0 1 1 2 7M3 4v7h7'],
  star:['m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z'],shield:['m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-4 10 3 3 5-6'],
  grid:['M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z'],more:['M5 12h.01M12 12h.01M19 12h.01'],
 };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{#each paths[name]||paths.folder as d}<path {d}/>{/each}</svg>
