import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getOwner,ownerConfigured,OWNER_EMAIL} from '../../../lib/owner-auth';
import OwnerAuthFrame from '../owner-auth-frame';
import OwnerForm from '../owner-form';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Owner sign-in | LumaNest TV',robots:{index:false,follow:false},referrer:'no-referrer'};

export default async function OwnerLogin() {
  if(await getOwner())redirect('/manage');
  return <OwnerAuthFrame><OwnerForm mode="login" email={OWNER_EMAIL} configured={await ownerConfigured()}/></OwnerAuthFrame>;
}
