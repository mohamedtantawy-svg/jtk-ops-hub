const EmptyState = ({ icon='bi-inbox', title='Nothing here', subtitle='', action }) => (
  <div style={{
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
    padding:'60px 24px', textAlign:'center', gap:'var(--space-3)',
  }}>
    <i className={`bi ${icon}`} style={{fontSize:36, color:'var(--text-disabled)', display:'block'}}/>
    <div style={{fontSize:'var(--font-md)', fontWeight:600, color:'var(--text-secondary)'}}>{title}</div>
    {subtitle && <div style={{fontSize:'var(--font-base)', color:'var(--text-muted)', maxWidth:300}}>{subtitle}</div>}
    {action && <div style={{marginTop:'var(--space-2)'}}>{action}</div>}
  </div>
);
export default EmptyState;
