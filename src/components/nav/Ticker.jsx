import { TOOLS } from '../../data/constants';

const Ticker=({items})=>{
  const d=[...items,...items];
  return(
    <div aria-hidden="true" role="marquee" style={{background:'#1b1b1b',height:36,display:'flex',alignItems:'center',overflow:'hidden',borderBottom:'1px solid #2d2d2d',flexShrink:0}}>
      <div style={{background:'var(--g)',color:'var(--text)',padding:'0 12px',height:'100%',display:'flex',alignItems:'center',fontSize:11,fontWeight:700,flexShrink:0,letterSpacing:'.05em'}}>
        <span className="pulse" style={{width:6,height:6,borderRadius:'50%',background:'#1b1b1b',display:'inline-block',marginRight:6}}></span>LIVE
      </div>
      <div style={{flex:1,overflow:'hidden'}}>
        <div className="ticker-track" style={{whiteSpace:'nowrap'}}>
          {d.map((item,i)=>{ const t=TOOLS[item.tool]; return(
            <span key={i} style={{display:'inline-flex',alignItems:'center',gap:6,marginRight:32,color:'var(--text-muted)',fontSize:12}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:t?.dot||'#9e9e9e',display:'inline-block',flexShrink:0}}></span>
              <span style={{color:'var(--text-secondary)',fontSize:11}}>[{t?.label}]</span>
              <span style={{color:'#dedede'}}>{item.text}</span>
              <span style={{color:'var(--text-secondary)',fontSize:11}}>{item.time}</span>
            </span>
          ); })}
        </div>
      </div>
    </div>
  );
};

export default Ticker;
