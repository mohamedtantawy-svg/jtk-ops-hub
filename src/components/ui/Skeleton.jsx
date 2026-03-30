const Skeleton = ({ width, height, circle, className, style }) => (
  <div className={`skeleton ${className||''}`}
    style={{ width: width||'100%', height: height||14, borderRadius: circle?'50%':undefined, ...style }} />
);

export const SkeletonRow = () => (
  <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',borderBottom:'1px solid var(--border-light)'}}>
    <Skeleton circle width={32} height={32} />
    <div style={{flex:1,display:'flex',flexDirection:'column',gap:6}}>
      <Skeleton className="skeleton-text" width="55%" />
      <Skeleton className="skeleton-text" width="30%" height={11} />
    </div>
    <Skeleton className="skeleton-text" width={60} height={22} style={{borderRadius:128}} />
  </div>
);

export const SkeletonCard = ({ lines=3 }) => (
  <div className="glass-card" style={{padding:20,display:'flex',flexDirection:'column',gap:12}}>
    <Skeleton className="skeleton-title" />
    {Array.from({length:lines}).map((_,i) => <Skeleton key={i} className="skeleton-text" width={`${70-i*15}%`} />)}
  </div>
);

export default Skeleton;
