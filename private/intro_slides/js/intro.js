(() => {
  'use strict';
  const slides = [...document.querySelectorAll('.slide')];
  const videos = [...document.querySelectorAll('video')];
  const $ = id => document.getElementById(id);
  let current = 0;
  let playingGroup = null;
  function navigate(index, setHash=true) {
    const frameHadFocus = document.activeElement?.tagName === 'IFRAME';
    index = Math.max(0, Math.min(slides.length-1, index));
    if (index !== current) playingGroup = null;
    slides.forEach((slide,i) => {
      const active = i === index;
      slide.classList.toggle('active',active);
      slide.inert = !active;
      slide.setAttribute('aria-hidden',String(!active));
      if (!active) slide.querySelectorAll('video').forEach(video=>video.pause());
    });
    current=index;
    if(frameHadFocus){document.body.tabIndex=-1;document.body.focus({preventScroll:true});}
    $('counter').textContent=`${index+1} / ${slides.length}`;
    $('previous').disabled = index === 0;
    $('next').disabled = index === slides.length-1;
    $('notes-title').textContent=slides[index].dataset.title;
    $('notes-content').replaceChildren(...[...slides[index].querySelector('.notes').childNodes].map(node=>node.cloneNode(true)));
    $('notes-panel').scrollTop=0;
    if(setHash) history.replaceState(null,'',`#slide-${index+1}`);
    window.scrollTo(0,0);
  }
  $('previous').onclick=()=>navigate(current-1);
  $('next').onclick=()=>navigate(current+1);
  $('notes-close').onclick=()=>{$('notes-panel').hidden=true;};
  async function handleKey(event){
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.target?.closest('input,textarea,select,video,iframe,[contenteditable]'))return;
    const key=event.key.toLowerCase();
    if(key===' '&&event.target?.closest('button'))return;
    if(['arrowright','arrowdown','pagedown',' '].includes(key)){event.preventDefault();navigate(current+1);}
    if(['arrowleft','arrowup','pageup'].includes(key)){event.preventDefault();navigate(current-1);}
    if(key==='home'){event.preventDefault();navigate(0);}
    if(key==='end'){event.preventDefault();navigate(slides.length-1);}
    if(key==='n')$('notes-panel').hidden=!$('notes-panel').hidden;
    if(key==='f'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}}
    if(key==='escape')$('notes-panel').hidden=true;
  }
  document.addEventListener('keydown',handleKey);
  window.addEventListener('message',event=>{
    const frame=[...slides[current].querySelectorAll('iframe')].find(frame=>event.source===frame.contentWindow);
    if(!frame)return;
    if(event.data?.type!=='eng654-instructor-key'||typeof event.data.key!=='string')return;
    handleKey({key:event.data.key,preventDefault(){}});
  });
  window.addEventListener('hashchange',()=>navigate((Number(location.hash.match(/slide-(\d+)/)?.[1])||1)-1,false));
  for(const [key,url] of Object.entries(window.INTRO_MEDIA||{})){
    if(!url)continue;
    const slot=document.querySelector(`[data-media="${key}"]`);
    if(slot){const video=slot.querySelector('video');video.onloadedmetadata=()=>slot.classList.add('ready');video.onerror=()=>slot.classList.remove('ready');video.src=url;continue;}
    if(key.endsWith('Photo')){
      const host=document.querySelector(`[data-photo="${key.replace('Photo','')}"]`);if(!host)continue;const img=host.querySelector('img');img.onload=()=>{img.hidden=false;host.querySelector('.monogram').hidden=true;};img.onerror=()=>{img.hidden=true;host.querySelector('.monogram').hidden=false;};img.src=url;continue;
    }
    if(key.endsWith('Slide')){
      const host=document.querySelector(`[data-tutor="${key.replace('Slide','')}"]`);
      const isHtml=/\.html?(?:[?#]|$)/i.test(url);
      const element=document.createElement(isHtml?'iframe':'img');
      element.className='tutor-replacement';
      if(isHtml){element.title=host.dataset.title+' introduction';element.setAttribute('sandbox','allow-scripts');}else element.alt=host.dataset.title+' introduction slide';
      element.src=url;if(!isHtml)element.onerror=()=>element.remove();host.append(element);
    }
  }
  $('play-all').onclick = () => {
    playingGroup = $('play-all').closest('.slide').querySelector('.video-grid');
    playingGroup.querySelectorAll('video').forEach(video => {
      video.currentTime = 0;
      video.play().catch(() => {}); // An unavailable clip must not block the others.
    });
  };
  videos.forEach(video => video.addEventListener('play', () => {
    if (!video.closest('.slide').classList.contains('active')) {
      video.pause();
      return;
    }
    if (!playingGroup?.contains(video)) playingGroup = null;
    videos.forEach(other => {
      if (other !== video && !playingGroup?.contains(other)) other.pause();
    });
  }));
  navigate((Number(location.hash.match(/slide-(\d+)/)?.[1])||1)-1,false);
  window.IntroDeck={goTo:slide=>navigate(slide-1),get current(){return current+1;}};
})();
