import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getOwner,OWNER_EMAIL} from '../../../lib/owner-auth';
import OwnerAuthFrame from '../owner-auth-frame';
import OwnerForm from '../owner-form';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Owner security | LumaNest TV',robots:{index:false,follow:false},referrer:'no-referrer'};

export default async function OwnerSecurity() {
  const owner=await getOwner();
  if(!owner)redirect('/manage/login');
  if(owner.method==='bootstrap')redirect('/manage/setup');
  return <OwnerAuthFrame><OwnerForm mode="security" email={OWNER_EMAIL}/></OwnerAuthFrame>;
}
