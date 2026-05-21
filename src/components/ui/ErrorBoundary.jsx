import React from 'react';

class ErrorBoundary extends React.Component{
  constructor(p){super(p);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(e){return{hasError:true,error:e};}
  componentDidCatch(error,info){console.error('Ops Hub Error:',error,info);}
  render(){if(this.state.hasError)return React.createElement('div',{style:{padding:40,textAlign:'center',fontFamily:'Inter,sans-serif'}},React.createElement('h2',{style:{color:'#d42d35'}},'Something went wrong'),React.createElement('pre',{style:{color:'var(--text-secondary)',fontSize:12,margin:'12px auto',maxWidth:600,textAlign:'left',whiteSpace:'pre-wrap'}},String(this.state.error)),React.createElement('button',{onClick:()=>location.reload(),style:{background:'#1f74b3',color:'white',border:'none',borderRadius:8,padding:'10px 24px',fontSize:14,cursor:'pointer',marginTop:16}},'Reload'));return this.props.children;}
}

export default ErrorBoundary;
