import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {requireChatGPTUser} from '../../chatgpt-auth';
import {getOwner,ownerConfigured,requireBootstrapOwner,OWNER_EMAIL} from '../../../lib/owner-auth';
import {ServiceError} from '../../../lib/mybunny';
import OwnerAuthFrame from '../owner-auth-frame';
import OwnerForm from '../owner-form';
import styles from '../owner-auth.module.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Set up owner login | LumaNest TV',robots:{index:false,follow:false},referrer:'no-referrer'};

export default async function OwnerSetup() {
  if(await ownerConfigured())redirect(await getOwner()?'/manage':'/manage/login');
  await requireChatGPTUser('/manage/setup');
  try {
    await requireBootstrapOwner();
  } catch(error) {
    if(error instanceof ServiceError&&error.status===409)redirect('/manage/login');
    if(!(error instanceof ServiceError)||error.status!==403)throw error;
    return <OwnerAuthFrame><h2>Owner access required.</h2><p className={styles.description}>This one-time setup is available only to the hosting account that created LumaNest TV.</p><a className={styles.primary} href="/signout-with-chatgpt?return_to=%2Fmanage%2Fsetup" target="_top">Use the owner hosting account ↗</a></OwnerAuthFrame>;
  }
  return <OwnerAuthFrame><OwnerForm mode="setup" email={OWNER_EMAIL}/></OwnerAuthFrame>;
}
