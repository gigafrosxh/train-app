import {connect,source} from '../src/database/database';
import {randomBytes,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {z} from 'zod';
async function main(){const train=z.uuid().parse(process.env.TRAIN_ID),name=z.string().min(1).max(100).parse(process.env.DEVICE_NAME);await connect();const token=randomBytes(40).toString('base64url');const [r]=await source.query('INSERT INTO ingestion_clients(name,token_hash,train_id) VALUES($1,$2,$3) RETURNING id',[name,createHash('sha256').update(token).digest('hex'),train]);try{await writeFile('device-'+r.id+'.secret',token+'\n',{mode:0o600,flag:'wx'});}catch(e){await source.query('DELETE FROM ingestion_clients WHERE id=$1',[r.id]);throw e;}await source.destroy();console.log('Device credential created in device-'+r.id+'.secret. Store securely and remove after provisioning.');}main().catch(e=>{console.error(e.message);process.exitCode=1;});
