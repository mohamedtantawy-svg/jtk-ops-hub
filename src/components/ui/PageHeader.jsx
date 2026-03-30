const PageHeader=({icon,iconBg,iconColor,title,subtitle,right})=>(
  <div className="page-header">
    {icon&&<div style={{width:40,height:40,borderRadius:12,background:iconBg||'#e3f2fd',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><i className={icon} style={{color:iconColor||'#1565c0',fontSize:18}}></i></div>}
    <div style={{flex:1,minWidth:0}}>
      <h2 style={{fontSize:24,fontWeight:700,color:'#1b1b1b',margin:0,lineHeight:1.3}}>{title}</h2>
      {subtitle&&<p style={{color:'#9e9e9e',fontSize:14,margin:'2px 0 0',lineHeight:1.4}}>{subtitle}</p>}
    </div>
    {right&&<div style={{flexShrink:0}}>{right}</div>}
  </div>
);

export default PageHeader;
