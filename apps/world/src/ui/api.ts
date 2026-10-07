const RETRYABLE_STATUS=new Set([429,500,502,503,504]);

/** Retry read-only API requests after transient server or connection errors. */
export async function readApi<T>(url:string,signal?:AbortSignal):Promise<T> {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
      if(response.ok)return await response.json() as T;
      if(!RETRYABLE_STATUS.has(response.status)||attempt===2)throw new Error(`API ${response.status}: ${url}`);
    } catch(error) {
      if(signal?.aborted||attempt===2||error instanceof Error&&error.message.startsWith('API '))throw error;
    }
    await new Promise<void>((resolve,reject)=>{
      const onAbort=()=>{clearTimeout(timer);reject(signal?.reason??new Error('Leitura cancelada.'));};
      const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},350*2**attempt);
      if(signal?.aborted)onAbort();
      else signal?.addEventListener('abort',onAbort,{once:true});
    });
  }
  throw new Error(`Não foi possível consultar ${url}.`);
}
