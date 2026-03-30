const Tooltip = ({ text, children, position='top' }) => (
  <div className="tooltip-wrap">
    {children}
    <span className="tooltip-text">{text}</span>
  </div>
);

export default Tooltip;
