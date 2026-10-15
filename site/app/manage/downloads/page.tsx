import type {Metadata} from 'next';import {redirect} from 'next/navigation';import {getOwner} from '../../../lib/owner-auth';import Upload from './upload';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Manage downloads | LumaNest TV',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Downloads(){if(!await getOwner())redirect('/manage/login');return <main className="console"><a href="/manage">← Owner console</a><h1 style={{fontSize:48}}>Tuner download</h1><p>Publish the approved signed APK for customers.</p><Upload/></main>}
