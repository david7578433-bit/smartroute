(function(){
var API=/sites\.tab\.bot$/.test(location.hostname)?"":"https://smartroute.sites.tab.bot";
var $=function(i){return document.getElementById(i)};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
async function load(){
  var key=$("k").value.trim(); $("st").textContent="Loading…";
  var r=await fetch(API+"/api/admin/reports",{headers:{"x-admin-key":key}}); var js=await r.json();
  if(!r.ok){$("st").textContent=r.status===403?"Wrong key.":"Error: "+(js.error||r.status);return;}
  try{sessionStorage.setItem("srk",key)}catch(e){}
  $("st").textContent=js.count+" reports";
  $("out").innerHTML=js.reports.map(function(x){return '<div class="card"><b>#'+x.id+' '+esc(x.kind)+'</b> · '+esc(x.at)+(x.hidden?' · <b>HIDDEN</b>':'')+'<br>'+esc(x.place)+'<br>'+esc(x.note)+'<br><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat='+x.lat+'&mlon='+x.lon+'#map=19/'+x.lat+'/'+x.lon+'">'+Number(x.lat).toFixed(5)+', '+Number(x.lon).toFixed(5)+'</a>'+(x.email?'<br>'+esc(x.email):'')+'<br><button class="btn small" data-id="'+x.id+'" data-h="'+(x.hidden?0:1)+'">'+(x.hidden?'Show on map':'Hide from map')+'</button></div>'}).join("");
  $("out").querySelectorAll("button[data-id]").forEach(function(b){b.onclick=async function(){await fetch(API+"/api/admin/reports",{method:"POST",headers:{"x-admin-key":key,"content-type":"application/json"},body:JSON.stringify({id:+b.dataset.id,hidden:+b.dataset.h})});load();}});
}
$("go").onclick=load; try{var k=sessionStorage.getItem("srk"); if(k){$("k").value=k;}}catch(e){}
})();