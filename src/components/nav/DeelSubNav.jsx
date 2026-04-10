import { FLAGS } from '../../data/constants';

const DeelSubNav=({view,subFilter,setSubFilter,tasks,user})=>{
  const subNavItems = {
    'my-queue': [], // Queue has its own integrated header
    'briefing': [],
    'projects': [],
    'calendar': [],
    'knowledge-hub': ['Policies','Runbooks','Tools','FAQs'],
    'analytics': ['Overview','SLA','Team Performance','Sources'],
    'settings': ['General','SLA Rules','Notifications','Export'],
  };

  const items = subNavItems[view] || [];
  if (items.length === 0) return null;

  return(
    <div style={{height:44,background:'var(--surface)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'stretch',paddingLeft:16,gap:0}}>
      {items.map((item, idx) => {
        const isActive=(!subFilter&&idx===0)||(subFilter===item);
        return(
          <div key={idx}
            onClick={()=>setSubFilter(item)}
            onMouseEnter={!isActive ? e => e.currentTarget.style.background='var(--surface-2)' : undefined}
            onMouseLeave={!isActive ? e => e.currentTarget.style.background='transparent' : undefined}
            style={{
              padding:'6px 12px',
              fontSize:14,
              fontWeight:500,
              color:isActive?'var(--purple)':'var(--text-secondary)',
              background:isActive?'var(--purple-light)':'transparent',
              borderRadius:'var(--radius-lg)',
              borderBottom:'none',
              cursor:'pointer',
              display:'flex',
              alignItems:'center',
              gap:6,
              marginRight:4,
              transition:'all .15s',
            }}>
            {item}
          </div>
        );
      })}
    </div>
  );
};

export default DeelSubNav;
