'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import styles from './owner-auth.module.css';

type Mode='login'|'setup'|'recover'|'security';
type OwnerResponse={ok?:boolean;recoveryCode?:string;error?:{message?:string}};

function PasswordField({name,label,newPassword=false,disabled=false,hint}:{name:string;label:string;newPassword?:boolean;disabled?:boolean;hint?:string}) {
  const id=useId();
  const [visible,setVisible]=useState(false);
  return <div className={styles.field}>
    <label htmlFor={id}>{label}</label>
    <span className={styles.password}>
      <input id={id} name={name} type={visible?'text':'password'} autoComplete={newPassword?'new-password':'current-password'} required minLength={newPassword?16:undefined} maxLength={128} disabled={disabled} aria-describedby={hint?id+'-hint':undefined}/>
      <button className={styles.visibility} type="button" aria-label={`${visible?'Hide':'Show'} ${label.toLowerCase()}`} aria-pressed={visible} onClick={()=>setVisible(!visible)} disabled={disabled}>{visible?'Hide':'Show'}</button>
    </span>
    {hint&&<small id={id+'-hint'}>{hint}</small>}
  </div>;
}

export default function OwnerForm({mode,email,configured=true}:{mode:Mode;email:string;configured?:boolean}) {
  const newPasswordMode=mode==='setup'||mode==='recover';
  const id=useId();
  const formRef=useRef<HTMLFormElement>(null);
  const errorRef=useRef<HTMLParagraphElement>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [recoveryCode,setRecoveryCode]=useState('');
  const [saved,setSaved]=useState(false);

  useEffect(()=>{
    if(!recoveryCode||saved)return;
    const preventLoss=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',preventLoss);
    return ()=>window.removeEventListener('beforeunload',preventLoss);
  },[recoveryCode,saved]);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy)return;
    const form=event.currentTarget;
    const data=new FormData(form);
    const password=String(data.get('password')??'');
    if(newPasswordMode&&password!==String(data.get('confirmPassword')??'')){
      setError('The passwords do not match. Please enter the same password in both fields.');
      (form.elements.namedItem('confirmPassword') as HTMLInputElement|null)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload=mode==='setup'||mode==='security'?{password}:mode==='recover'?{email:String(data.get('email')??''),password,recoveryCode:String(data.get('recoveryCode')??'')}:{email:String(data.get('email')??''),password};
      const response=await fetch('/api/owner/'+(mode==='security'?'recovery-code':mode),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json().catch(()=>{throw new Error('Owner access is temporarily unavailable. Please try again.');}) as OwnerResponse;
      if(!response.ok||result.ok!==true)throw new Error(result.error?.message||'Unable to complete this request. Please try again.');
      if(mode==='login'){
        form.reset();
        window.location.assign('/manage');
        return;
      }
      if(!result.recoveryCode)throw new Error('The recovery code could not be displayed. Open owner security from the console to create a new code with your password.');
      form.reset();
      setRecoveryCode(result.recoveryCode);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'Unable to connect. Please try again.');
      requestAnimationFrame(()=>errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  function downloadRecovery() {
    const text=`LumaNest TV owner recovery\n\nOwner email: ${email}\nRecovery page: https://lumanest.tv/manage/recover\nRecovery code: ${recoveryCode}\n\nKeep this file private in a password manager or another secure place.\nThis code can reset your owner password. A reset replaces it with a new code.\n`;
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='lumanest-owner-recovery.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  if(recoveryCode)return <div>
    <p className={styles.success} role="status">{mode==='setup'?'Owner login created':mode==='security'?'Recovery code replaced':'Password updated'}</p>
    <h2>Save your recovery code.</h2>
    <p className={styles.description}>Store this code in a password manager or another private, secure place. It lets you reset the owner password if you forget it.</p>
    <div className={styles.recovery}><span>ONE-TIME DISPLAY · KEEP PRIVATE</span><code>{recoveryCode}</code></div>
    <p className={styles.notice}>This code is shown once and replaces any previous code. No recovery email is sent.</p>
    <button type="button" className={styles.secondary} onClick={downloadRecovery}>Download recovery file</button>
    <label className={styles.check}><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>I saved this recovery code somewhere private.</label>
    <button className={styles.primary} type="button" disabled={!saved} onClick={()=>{setRecoveryCode('');window.location.assign('/manage');}}>Continue to owner console ↗</button>
  </div>;

  if(mode==='login'&&!configured)return <div>
    <h2>Set up owner access.</h2>
    <p className={styles.description}>Create a private LumaNest owner login for <strong>{email}</strong>.</p>
    <p className={styles.notice}>For this one-time setup, verify access with the hosting account that created the website. Then choose your LumaNest password and save your recovery code.</p>
    <a className={styles.primary} href="/manage/setup" target="_top">Set up owner login ↗</a>
    <p className={styles.footnote}>Customer accounts use their own line credentials.</p>
  </div>;

  return <div>
    <h2>{mode==='login'?'Welcome back.':mode==='setup'?'Make it yours.':mode==='security'?'Replace recovery code.':'Reset owner password.'}</h2>
    <p className={styles.description}>{mode==='login'?'Sign in with your LumaNest owner email and password.':mode==='setup'?<>Your owner email is <strong>{email}</strong>. Choose a private password to finish setting up your LumaNest login.</>:mode==='security'?'Confirm your current owner password to create a new recovery code. Your previous code will stop working. Save the new code before leaving this page.':'Use your saved recovery code to choose a new password. This signs out existing owner sessions.'}</p>
    <form ref={formRef} className={styles.form} onSubmit={submit} aria-busy={busy}>
      {(mode==='login'||mode==='recover')&&<div className={styles.field}>
        <label htmlFor={id+'-email'}>Owner email</label>
        <input id={id+'-email'} name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={254} defaultValue={email} disabled={busy}/>
      </div>}
      {mode==='recover'&&<div className={styles.field}>
        <label htmlFor={id+'-code'}>Recovery code</label>
        <input id={id+'-code'} name="recoveryCode" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={128} disabled={busy} aria-describedby={id+'-code-hint'}/>
        <small id={id+'-code-hint'}>Enter the code saved when you set up or last reset owner access.</small>
      </div>}
      <PasswordField name="password" label={mode==='login'?'Password':mode==='security'?'Current password':'New password'} newPassword={newPasswordMode} disabled={busy} hint={newPasswordMode?'Use 16–128 characters. A long, unique passphrase works well.':undefined}/>
      {newPasswordMode&&<PasswordField name="confirmPassword" label="Confirm new password" newPassword disabled={busy}/>}
      {error&&<p ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>{error}</p>}
      <button className={styles.primary} disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in ↗':mode==='setup'?'Create owner login ↗':mode==='security'?'Replace recovery code ↗':'Reset password ↗'}</button>
    </form>
    {mode==='login'&&<div className={styles.links}><a href="/manage/recover">Forgot your password?</a></div>}
    {mode==='recover'&&<div className={styles.links}><a href="/manage/login">Return to owner sign-in</a></div>}
    {mode==='setup'&&<div className={styles.links}><a href="/manage">Return to owner console</a></div>}
    {mode==='security'&&<div className={styles.links}><a href="/manage">Return to owner console</a><a href="/manage/recover">Reset password with a recovery code</a></div>}
    <p className={styles.footnote}>{mode==='login'?'Owner access is separate from customer line sign-in.':mode==='setup'?'After setup, sign in here with your LumaNest email and password.':mode==='security'?'Keep your recovery code private. No email is sent.':'Recovery uses your saved code. No email is sent.'}</p>
  </div>;
}
