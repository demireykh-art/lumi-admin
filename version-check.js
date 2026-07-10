/* ===== version-check.js =====
 * 브라우저가 옛 HTML/JS 를 캐시하고 있을 때 자동으로 새 버전을 감지해
 * 화면 상단에 재로드 배너를 띄운다. Ctrl+Shift+R 없이도 배포 즉시 반영.
 *
 * 동작:
 *   - 페이지 로드 후 20초 대기 → 이후 60초마다 self HTML 을 HEAD 요청
 *   - 최초 응답의 ETag/Last-Modified 를 baseline 으로 기억
 *   - 이후 응답에서 값이 바뀌면 배너 표시 (5초 카운트다운 후 자동 새로고침)
 *   - 실패(네트워크 오류/헤더 없음)는 조용히 무시
 *   - 사용자가 입력창에 포커스 중이거나 모달이 열려있으면 자동 새로고침 스킵
 */
(function(){
    if(window.__lumiVersionCheckLoaded) return;
    window.__lumiVersionCheckLoaded=true;

    let baselineETag=null;
    let baselineLastMod=null;
    let bannerShown=false;

    async function fetchHeaders(){
        try{
            const url=location.pathname+'?_vc='+Date.now();
            const res=await fetch(url,{method:'HEAD',cache:'no-store'});
            if(!res.ok) return null;
            return {
                etag:res.headers.get('ETag'),
                lastMod:res.headers.get('Last-Modified'),
            };
        }catch(_){ return null; }
    }

    function isBusyState(){
        // 입력 중이거나 모달이 열린 상태면 자동 새로고침 미룸
        const ae=document.activeElement;
        if(ae&&/^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName)){
            const val=('value' in ae)?String(ae.value||'').trim():'';
            if(val!=='') return true;
        }
        // .modal.active 가 있으면 모달 표시 중
        return document.querySelectorAll('.modal.active').length>0;
    }

    function showUpdateBanner(){
        if(bannerShown) return;
        bannerShown=true;
        const banner=document.createElement('div');
        banner.id='__lumiUpdateBanner';
        banner.style.cssText='position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#10b981,#059669);color:#fff;padding:.9rem 1rem;text-align:center;font-weight:600;z-index:99999;box-shadow:0 3px 12px rgba(0,0,0,.2);font-size:.9rem';
        banner.innerHTML=
            '<span>✨ 새 버전이 있습니다.</span> '+
            '<span id="__lumiUpdateCountdown" style="opacity:.9">10초 후 자동 새로고침…</span> '+
            '<button id="__lumiUpdateNow" style="margin-left:.8rem;padding:.35rem 1rem;background:#fff;color:#059669;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:.85rem">지금 새로고침</button> '+
            '<button id="__lumiUpdateLater" style="margin-left:.4rem;padding:.35rem .8rem;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:6px;font-weight:500;cursor:pointer;font-size:.8rem">나중에</button>';
        document.body.appendChild(banner);
        document.getElementById('__lumiUpdateNow').onclick=()=>location.reload();
        document.getElementById('__lumiUpdateLater').onclick=()=>{
            banner.remove();
            bannerShown=false;
            // 다음 감지 시 다시 안내
        };

        // 카운트다운 (10초). 입력 중이면 카운트 멈춤
        let remain=10;
        const cd=document.getElementById('__lumiUpdateCountdown');
        const timer=setInterval(()=>{
            if(!document.getElementById('__lumiUpdateBanner')){ clearInterval(timer); return; }
            if(isBusyState()){
                if(cd) cd.textContent='입력 완료 후 자동 새로고침';
                return;
            }
            remain--;
            if(cd) cd.textContent=`${remain}초 후 자동 새로고침…`;
            if(remain<=0){
                clearInterval(timer);
                location.reload();
            }
        },1000);
    }

    async function check(){
        const h=await fetchHeaders();
        if(!h) return;
        const changed=(h.etag&&baselineETag&&h.etag!==baselineETag)
            ||(!baselineETag&&h.lastMod&&baselineLastMod&&h.lastMod!==baselineLastMod);
        if(baselineETag===null&&baselineLastMod===null){
            baselineETag=h.etag; baselineLastMod=h.lastMod; return;
        }
        if(changed) showUpdateBanner();
    }

    // 최초 20초 후 baseline 확정 → 이후 60초마다 폴링
    setTimeout(()=>{ check(); setInterval(check,60_000); }, 20_000);
})();
