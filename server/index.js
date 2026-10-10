const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'vault-local-development-secret-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production.');
const webDir = path.join(__dirname, '..', 'www');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'vault.db'));

const DEFAULT_CATEGORIES = [
  { systemKey: 'games', name: 'Videojogos', icon: '🎮', color: '#5df2c2' },
  { systemKey: 'comics', name: 'Banda desenhada', icon: '📖', color: '#ffe45e' },
  { systemKey: 'cards', name: 'Cartas', icon: '🃏', color: '#ff6b9d' },
  { systemKey: 'pops', name: 'Funko Pop!', icon: '🤖', color: '#9b87f5' },
  { systemKey: 'figures', name: 'Figuras', icon: '🦸', color: '#ff8a5b' }
];

db.exec(`
  PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,platform TEXT NOT NULL,condition TEXT NOT NULL,paid REAL NOT NULL DEFAULT 0,value REAL NOT NULL DEFAULT 0,completeness TEXT NOT NULL,region TEXT NOT NULL,cover TEXT NOT NULL DEFAULT '',acquired_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,system_key TEXT,name TEXT NOT NULL,icon TEXT NOT NULL DEFAULT '◇',color TEXT NOT NULL DEFAULT '#5df2c2',sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,UNIQUE(user_id,name),UNIQUE(user_id,system_key));
  CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,category_id TEXT NOT NULL,title TEXT NOT NULL,subtitle TEXT NOT NULL DEFAULT '',brand TEXT NOT NULL DEFAULT '',series TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL DEFAULT '',platform TEXT NOT NULL DEFAULT '',condition TEXT NOT NULL DEFAULT 'Muito bom',completeness TEXT NOT NULL DEFAULT '',region TEXT NOT NULL DEFAULT '',language TEXT NOT NULL DEFAULT '',barcode TEXT NOT NULL DEFAULT '',quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 99999),paid REAL NOT NULL DEFAULT 0 CHECK(paid>=0),value REAL NOT NULL DEFAULT 0 CHECK(value>=0),currency TEXT NOT NULL DEFAULT 'EUR',cover TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'owned' CHECK(status IN ('owned','wishlist','sold')),metadata_json TEXT NOT NULL DEFAULT '{}',acquired_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE RESTRICT);
  CREATE INDEX IF NOT EXISTS games_user_id_idx ON games(user_id);
  CREATE INDEX IF NOT EXISTS categories_user_idx ON categories(user_id,sort_order);
  CREATE INDEX IF NOT EXISTS items_user_category_idx ON items(user_id,category_id);
  CREATE INDEX IF NOT EXISTS items_user_status_idx ON items(user_id,status);
  CREATE INDEX IF NOT EXISTS items_user_updated_idx ON items(user_id,updated_at DESC);
`);

function ensureCategories(userId) {
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT OR IGNORE INTO categories (id,user_id,system_key,name,icon,color,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  DEFAULT_CATEGORIES.forEach((c, index) => insert.run(crypto.randomUUID(),userId,c.systemKey,c.name,c.icon,c.color,index,now,now));
}
function migrateGames(userId) {
  ensureCategories(userId);
  const category = db.prepare("SELECT id FROM categories WHERE user_id=? AND system_key='games'").get(userId);
  if (!category) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO items (id,user_id,category_id,title,platform,condition,completeness,region,quantity,paid,value,currency,cover,status,metadata_json,acquired_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.prepare('SELECT * FROM games WHERE user_id=?').all(userId).forEach(g => insert.run(g.id,userId,category.id,g.title,g.platform,g.condition,g.completeness,g.region,1,g.paid,g.value,'EUR',g.cover,'owned','{}',g.acquired_at,g.updated_at));
}
db.prepare('SELECT id FROM users').all().forEach(user => migrateGames(user.id));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use((req,res,next) => {
  res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(self), geolocation=()'});
  if (process.env.NODE_ENV === 'production' && process.env.CANONICAL_HOST && req.hostname !== process.env.CANONICAL_HOST) return res.redirect(308,`https://${process.env.CANONICAL_HOST}${req.originalUrl}`);
  next();
});
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(v=>v.trim()).filter(Boolean);
app.use(cors({origin(origin,cb){if(!origin||!allowedOrigins?.length||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('Origin not allowed.'));}}));
app.use(express.json({limit:'1mb'}));

const attempts = new Map();
function authRateLimit(req,res,next){const key=req.ip||'unknown',now=Date.now(),record=attempts.get(key)||{count:0,resetAt:now+900000};if(now>record.resetAt){record.count=0;record.resetAt=now+900000;}record.count++;attempts.set(key,record);if(record.count>30)return res.status(429).json({error:'Demasiadas tentativas. Aguarda alguns minutos.'});next();}
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const safeNumber=(value,max=10000000)=>{const number=Number(value||0);return Number.isFinite(number)?Math.min(Math.max(number,0),max):0;};
const safeDate=value=>{const date=new Date(value||Date.now());return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();};
const publicUser=user=>({id:user.id,name:user.name,email:user.email});
const createToken=user=>jwt.sign({sub:user.id,email:user.email},JWT_SECRET,{expiresIn:'30d',issuer:'vault-exe'});
const toCategory=row=>({id:row.id,systemKey:row.system_key,name:row.name,icon:row.icon,color:row.color,sortOrder:row.sort_order});
const toItem=row=>({id:row.id,categoryId:row.category_id,title:row.title,subtitle:row.subtitle,brand:row.brand,series:row.series,reference:row.reference,platform:row.platform,condition:row.condition,completeness:row.completeness,region:row.region,language:row.language,barcode:row.barcode,quantity:row.quantity,paid:row.paid,value:row.value,currency:row.currency,cover:row.cover,notes:row.notes,status:row.status,metadata:JSON.parse(row.metadata_json||'{}'),createdAt:row.acquired_at.slice(0,10),updatedAt:row.updated_at});
const toGame=row=>({id:row.id,title:row.title,platform:row.platform,condition:row.condition,paid:row.paid,value:row.value,completeness:row.completeness,region:row.region,cover:row.cover,createdAt:row.acquired_at.slice(0,10),updatedAt:row.updated_at});
function requireAuth(req,res,next){const token=req.headers.authorization?.replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Authentication required.'});try{req.auth=jwt.verify(token,JWT_SECRET);next();}catch{return res.status(401).json({error:'Your session is invalid or has expired.'});}}

function normalizeItem(input){
  const metadata=input.metadata&&typeof input.metadata==='object'&&!Array.isArray(input.metadata)?input.metadata:{};
  return {id:clean(input.id||crypto.randomUUID(),80),categoryId:clean(input.categoryId,80),title:clean(input.title,240),subtitle:clean(input.subtitle,240),brand:clean(input.brand,120),series:clean(input.series,160),reference:clean(input.reference,100),platform:clean(input.platform,120),condition:clean(input.condition||'Muito bom',60),completeness:clean(input.completeness,80),region:clean(input.region,60),language:clean(input.language,60),barcode:clean(input.barcode,80),quantity:Math.max(1,Math.trunc(safeNumber(input.quantity||1,99999))),paid:safeNumber(input.paid),value:safeNumber(input.value),currency:clean(input.currency||'EUR',3).toUpperCase(),cover:clean(input.cover,2000),notes:clean(input.notes,4000),status:['owned','wishlist','sold'].includes(input.status)?input.status:'owned',metadata:JSON.stringify(metadata).slice(0,8000),acquiredAt:safeDate(input.createdAt||input.acquiredAt),updatedAt:safeDate(input.updatedAt||Date.now())};
}
function saveItem(userId,input){
  const item=normalizeItem(input);
  if(!item.title||!item.categoryId)throw Object.assign(new Error('Title and category are required.'),{status:400});
  const category=db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(item.categoryId,userId);
  if(!category)throw Object.assign(new Error('Category not found.'),{status:404});
  const owner=db.prepare('SELECT user_id,updated_at FROM items WHERE id=?').get(item.id);
  if(owner&&owner.user_id!==userId)item.id=crypto.randomUUID();
  if(owner&&new Date(owner.updated_at)>new Date(item.updatedAt))return toItem(db.prepare('SELECT * FROM items WHERE id=?').get(item.id));
  db.prepare(`INSERT INTO items (id,user_id,category_id,title,subtitle,brand,series,reference,platform,condition,completeness,region,language,barcode,quantity,paid,value,currency,cover,notes,status,metadata_json,acquired_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,title=excluded.title,subtitle=excluded.subtitle,brand=excluded.brand,series=excluded.series,reference=excluded.reference,platform=excluded.platform,condition=excluded.condition,completeness=excluded.completeness,region=excluded.region,language=excluded.language,barcode=excluded.barcode,quantity=excluded.quantity,paid=excluded.paid,value=excluded.value,currency=excluded.currency,cover=excluded.cover,notes=excluded.notes,status=excluded.status,metadata_json=excluded.metadata_json,acquired_at=excluded.acquired_at,updated_at=excluded.updated_at WHERE items.user_id=excluded.user_id`).run(item.id,userId,item.categoryId,item.title,item.subtitle,item.brand,item.series,item.reference,item.platform,item.condition,item.completeness,item.region,item.language,item.barcode,item.quantity,item.paid,item.value,item.currency,item.cover,item.notes,item.status,item.metadata,item.acquiredAt,item.updatedAt);
  if(category.system_key==='games')db.prepare(`INSERT INTO games (id,user_id,title,platform,condition,paid,value,completeness,region,cover,acquired_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,platform=excluded.platform,condition=excluded.condition,paid=excluded.paid,value=excluded.value,completeness=excluded.completeness,region=excluded.region,cover=excluded.cover,acquired_at=excluded.acquired_at,updated_at=excluded.updated_at WHERE games.user_id=excluded.user_id`).run(item.id,userId,item.title,item.platform,item.condition,item.paid,item.value,item.completeness,item.region,item.cover,item.acquiredAt,item.updatedAt);
  return toItem(db.prepare('SELECT * FROM items WHERE id=?').get(item.id));
}
function saveLegacyGame(userId,input){ensureCategories(userId);const category=db.prepare("SELECT id FROM categories WHERE user_id=? AND system_key='games'").get(userId);return saveItem(userId,{...input,categoryId:category.id,createdAt:input.createdAt||input.acquiredAt});}

app.get('/api/health',(_req,res)=>res.json({status:'ok',service:'vault-api',version:'2.0'}));
app.post('/api/auth/register',authRateLimit,async(req,res,next)=>{try{const name=clean(req.body?.name,80),email=clean(req.body?.email,254).toLowerCase(),password=String(req.body?.password||'');if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||password.length>128)return res.status(400).json({error:'Enter your name, a valid email, and a password with 8 to 128 characters.'});if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return res.status(409).json({error:'An account with this email already exists.'});const now=new Date().toISOString(),user={id:crypto.randomUUID(),name,email};db.exec('BEGIN');try{db.prepare('INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(user.id,name,email,await bcrypt.hash(password,12),now,now);ensureCategories(user.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}res.status(201).json({token:createToken(user),user});}catch(error){next(error);}});
app.post('/api/auth/login',authRateLimit,async(req,res,next)=>{try{const email=clean(req.body?.email,254).toLowerCase(),user=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!user||!(await bcrypt.compare(String(req.body?.password||''),user.password_hash)))return res.status(401).json({error:'Incorrect email or password.'});migrateGames(user.id);res.json({token:createToken(user),user:publicUser(user)});}catch(error){next(error);}});
app.get('/api/me',requireAuth,(req,res)=>{const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);if(!user)return res.status(404).json({error:'Account not found.'});res.json({user:publicUser(user)});});

app.get('/api/categories',requireAuth,(req,res)=>{ensureCategories(req.auth.sub);res.json({categories:db.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY sort_order,name').all(req.auth.sub).map(toCategory)});});
app.post('/api/categories',requireAuth,(req,res,next)=>{try{const name=clean(req.body?.name,60);if(name.length<2)return res.status(400).json({error:'Category name must have at least 2 characters.'});const now=new Date().toISOString(),id=crypto.randomUUID(),icon=clean(req.body?.icon||'◇',8),color=/^#[0-9a-f]{6}$/i.test(req.body?.color)?req.body.color:'#5df2c2',order=db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 value FROM categories WHERE user_id=?').get(req.auth.sub).value;db.prepare('INSERT INTO categories (id,user_id,system_key,name,icon,color,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,req.auth.sub,null,name,icon,color,order,now,now);res.status(201).json({category:toCategory(db.prepare('SELECT * FROM categories WHERE id=?').get(id))});}catch(error){if(String(error.message).includes('UNIQUE'))return res.status(409).json({error:'You already have a category with this name.'});next(error);}});
app.patch('/api/categories/:id',requireAuth,(req,res,next)=>{try{const category=db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(clean(req.params.id,80),req.auth.sub);if(!category)return res.status(404).json({error:'Category not found.'});const name=clean(req.body?.name??category.name,60),icon=clean(req.body?.icon??category.icon,8),color=/^#[0-9a-f]{6}$/i.test(req.body?.color)?req.body.color:category.color;if(name.length<2)return res.status(400).json({error:'Category name must have at least 2 characters.'});db.prepare('UPDATE categories SET name=?,icon=?,color=?,updated_at=? WHERE id=? AND user_id=?').run(name,icon,color,new Date().toISOString(),category.id,req.auth.sub);res.json({category:toCategory(db.prepare('SELECT * FROM categories WHERE id=?').get(category.id))});}catch(error){next(error);}});
app.delete('/api/categories/:id',requireAuth,(req,res)=>{const category=db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(clean(req.params.id,80),req.auth.sub);if(!category)return res.status(404).json({error:'Category not found.'});if(category.system_key)return res.status(409).json({error:'Built-in categories cannot be removed.'});if(db.prepare('SELECT 1 FROM items WHERE category_id=? LIMIT 1').get(category.id))return res.status(409).json({error:'Move or remove the items in this category first.'});db.prepare('DELETE FROM categories WHERE id=?').run(category.id);res.status(204).end();});

app.get('/api/items',requireAuth,(req,res)=>{const limit=Math.min(Math.max(Number(req.query.limit)||5000,1),5000);res.json({items:db.prepare('SELECT * FROM items WHERE user_id=? ORDER BY updated_at DESC LIMIT ?').all(req.auth.sub,limit).map(toItem)});});
app.post('/api/items',requireAuth,(req,res,next)=>{try{res.status(201).json({item:saveItem(req.auth.sub,req.body||{})});}catch(error){next(error);}});
app.post('/api/sync',requireAuth,(req,res,next)=>{const incoming=Array.isArray(req.body?.items)?req.body.items.slice(0,5000):[],deleted=Array.isArray(req.body?.deletedIds)?req.body.deletedIds.slice(0,5000).map(id=>clean(id,80)):[];db.exec('BEGIN');try{deleted.forEach(id=>{db.prepare('DELETE FROM games WHERE id=? AND user_id=?').run(id,req.auth.sub);db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(id,req.auth.sub);});incoming.filter(item=>!deleted.includes(item.id)).forEach(item=>saveItem(req.auth.sub,item));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');return next(error);}res.json({categories:db.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY sort_order,name').all(req.auth.sub).map(toCategory),items:db.prepare('SELECT * FROM items WHERE user_id=? ORDER BY updated_at DESC').all(req.auth.sub).map(toItem)});});
app.delete('/api/items/:id',requireAuth,(req,res)=>{const id=clean(req.params.id,80);db.prepare('DELETE FROM games WHERE id=? AND user_id=?').run(id,req.auth.sub);const result=db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(id,req.auth.sub);if(!result.changes)return res.status(404).json({error:'Item not found.'});res.status(204).end();});

// Compatibility layer for already installed v1 Android apps.
app.get('/api/games',requireAuth,(req,res)=>res.json({games:db.prepare('SELECT * FROM games WHERE user_id=? ORDER BY acquired_at DESC').all(req.auth.sub).map(toGame)}));
app.post('/api/games',requireAuth,(req,res,next)=>{try{const item=saveLegacyGame(req.auth.sub,req.body||{});res.status(201).json({game:toGame(db.prepare('SELECT * FROM games WHERE id=?').get(item.id))});}catch(error){next(error);}});
app.post('/api/games/sync',requireAuth,(req,res,next)=>{const incoming=Array.isArray(req.body?.games)?req.body.games.slice(0,5000):[],deleted=Array.isArray(req.body?.deletedIds)?req.body.deletedIds.slice(0,5000).map(id=>clean(id,80)):[];db.exec('BEGIN');try{deleted.forEach(id=>{db.prepare('DELETE FROM games WHERE id=? AND user_id=?').run(id,req.auth.sub);db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(id,req.auth.sub);});incoming.filter(game=>!deleted.includes(game.id)).forEach(game=>saveLegacyGame(req.auth.sub,game));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');return next(error);}res.json({games:db.prepare('SELECT * FROM games WHERE user_id=? ORDER BY acquired_at DESC').all(req.auth.sub).map(toGame)});});
app.delete('/api/games/:id',requireAuth,(req,res)=>{const id=clean(req.params.id,80);db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(id,req.auth.sub);const result=db.prepare('DELETE FROM games WHERE id=? AND user_id=?').run(id,req.auth.sub);if(!result.changes)return res.status(404).json({error:'Game not found.'});res.status(204).end();});

app.use(express.static(webDir,{maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.use((req,res,next)=>{if(req.method!=='GET')return next();if(req.path.startsWith('/api/')||req.path.startsWith('/downloads/')||path.extname(req.path))return res.status(404).json({error:'File or endpoint not found.'});res.sendFile(path.join(webDir,'index.html'));});
app.use((error,_req,res,_next)=>{console.error(error);const status=error.status||(error.message==='Origin not allowed.'?403:500);res.status(status).json({error:status<500?error.message:'A server error occurred.'});});

let server;
function start(){server=app.listen(PORT,()=>console.log(`Vault available at http://localhost:${PORT}`));return server;}
function close(){if(server)server.close();db.close();}
if(require.main===module)start();
process.on('SIGTERM',close);
module.exports={app,db,start,close};
