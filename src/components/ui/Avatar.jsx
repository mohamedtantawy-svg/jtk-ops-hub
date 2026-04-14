import { useState } from 'react';

const SIZES = { xs: 20, sm: 24, md: 28, lg: 32, xl: 36 };

const Avatar=({name='',initials,src,size='md',style,...props})=>{
  const px = SIZES[size] || (typeof size === 'number' ? size : 28);
  const safeName=name||initials||'?';
  const i=initials||(safeName.split(' ').map(n=>n[0]||'').join('').slice(0,2)||'?');
  const [imgErr,setImgErr]=useState(false);
  const base={width:px,height:px,borderRadius:'50%',flexShrink:0,overflow:'hidden'};
  if(src&&!imgErr){
    return <img
      src={src}
      alt={safeName}
      title={name||initials}
      onError={()=>setImgErr(true)}
      style={{...base,objectFit:'cover',...style}}
      {...props}
    />;
  }
  return <div
    role="img"
    aria-label={safeName}
    title={name||initials}
    style={{
      ...base,
      background:'var(--purple-mid, #ede9fe)',
      color:'var(--purple, #7c3aed)',
      display:'flex',alignItems:'center',justifyContent:'center',
      fontSize:px*.37,fontWeight:700,
      letterSpacing:'-0.02em',
      ...style
    }}
    {...props}
  >{i}</div>;
};

export default Avatar;
