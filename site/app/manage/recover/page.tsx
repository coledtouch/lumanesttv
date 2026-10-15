import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {ownerConfigured,OWNER_EMAIL} from '../../../lib/owner-auth';
import OwnerAuthFrame from '../owner-auth-frame';
import OwnerForm from '../owner-form';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Recover owner access | LumaNest TV',robots:{index:false,follow:false},referrer:'no-referrer'};

export default async function RecoverOwner() {
  if(!await ownerConfigured())redirect('/manage/setup');
  return <OwnerAuthFrame><OwnerForm mode="recover" email={OWNER_EMAIL}/></OwnerAuthFrame>;
}
