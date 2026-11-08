(async()=>{
 const files=[];
 // Accept a corrupt file through the actual file input and return via Back.
 const input=document.querySelector('input[type=file]'),dt=new DataTransfer();
 dt.items.add(new File(['not audio'], 'broken.wav', {type:'audio/wav'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(r=>setTimeout(r,500));
 const back=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='back');
 const failed=!!back&&document.body.textContent.includes('error');
 back?.click();await new Promise(r=>setTimeout(r,150));
 const recovered=!!document.querySelector('input[type=file]');
 const upload=await(await fetch('/src/components/UploadScreen.tsx')).text();const url=upload.match(/from "(\/src\/game\/anim\/recorder\.ts[^"]*)"/)[1];
 const {recorder}=await import(url);
 return {files,failed,recovered,loaded:recorder.loaded,inserting:recorder.inserting,failures:!failed||!recovered||recorder.loaded||recorder.inserting?['Corrupt-file recovery failed']:[]};
})()
