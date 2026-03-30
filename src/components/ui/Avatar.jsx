const SIZES = { xs: 20, sm: 24, md: 28, lg: 32, xl: 36 };

const Avatar=({name='',initials,size='md',style,...props})=>{
  const px = SIZES[size] || (typeof size === 'number' ? size : 28);
  const safeName=name||initials||'?';
  const i=initials||(safeName.split(' ').map(n=>n[0]||'').join('').slice(0,2)||'?');
  return <div
    role="img"
    aria-label={safeName}
    title={name||initials}
    style={{
      width:px,height:px,
      borderRadius:'50%',
      background:'var(--purple-mid, #ede9fe)',
      color:'var(--purple, #7c3aed)',
      display:'flex',alignItems:'center',justifyContent:'center',
      fontSize:px*.37,fontWeight:700,
      flexShrink:0,letterSpacing:'-0.02em',
      ...style
    }}
    {...props}
  >{i}</div>;
};

export default Avatar;
