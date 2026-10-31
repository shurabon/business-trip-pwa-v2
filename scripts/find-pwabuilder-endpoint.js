async function main() {
  const res = await fetch('https://www.pwabuilder.com/code/app-report.api-DHu52P9U.js');
  const js = await res.text();
  
  const pos = js.indexOf('function C(e){');
  console.log(js.substring(pos, pos + 1200));
}
main().catch(console.error);
