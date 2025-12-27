# Gmail Puppeteer Checker

**Gmail Puppeteer Checker** é uma ferramenta de automação desenvolvida em Node.js para validação de sessões de contas Google. O script utiliza o `puppeteer-extra` com o plugin Stealth para simular um navegador real, gerenciando cookies, proxies e consumo de memória de forma eficiente.

## 🚀 Funcionalidades

* **Navegação Furtiva (Stealth):** Utiliza técnicas para evitar detecção de automação.
* **Gerenciamento de Sessão:** Salva e reutiliza cookies (`trusted_cookies.json`) para evitar logins repetitivos.
* **Suporte a Proxy:** Suporta rotação de proxies e marcação automática de proxies inativos.
* **Controle de Memória:** Monitora o uso de RAM para não exceder a quota definida.
* **Detecção de Captcha:** Identifica solicitações de Captcha e oferece opções de intervenção.

## 📋 Pré-requisitos

* [Node.js](https://nodejs.org/) (versão 16 ou superior).
* Google Chrome instalado.

## 📦 Instalação

1.  Clone este repositório:
    ~~~bash
    git clone https://github.com/SEU_USUARIO/gmail-puppeteer-checker.git
    cd gmail-puppeteer-checker
    ~~~

2.  Instale as dependências:
    ~~~bash
    npm install
    ~~~

## ⚙️ Configuração

### 1. Arquivo `config.json`
Renomeie o arquivo `config.example.json` para `config.json` e ajuste conforme sua necessidade (ex: definir `MODO` como "producao" ou "testes").

### 2. Arquivos de Entrada

O script busca arquivos `.txt` na raiz do projeto para ler as contas e os proxies.

#### A. Lista de Contas
Crie um arquivo (ex: `gmail.txt` ou `testes.txt`, conforme definido no `config.json`). O formato deve ser estritamente **email:senha**, um por linha:

~~~text
usuario1@gmail.com:senha123
usuario2@gmail.com:senha456
~~~

#### B. Lista de Proxies
Crie o arquivo `proxies.txt` na raiz. O script aceita dois formatos (com ou sem autenticação):

* **Apenas IP e Porta:**
  ~~~text
  192.168.0.1:8080
  ~~~

* **Com Autenticação (IP:Porta:Usuario:Senha):**
  ~~~text
  192.168.0.1:8080:usuario:senha
  ~~~

**Nota:** Se um proxy falhar durante a conexão, o script o marcará automaticamente com um "X" e a data da falha no arquivo (ex: `X 1.2.3.4:80 -- [DEAD 10:00]`), evitando que ele seja reutilizado na próxima execução.

## ▶️ Como Usar

Para iniciar a validação, execute o comando abaixo no terminal:

~~~bash
node menu.js
~~~

O script exibirá o progresso no console:
* Se o modo **HEADLESS** estiver como `"new"` (config padrão), o navegador ficará oculto.
* Caso um **Captcha** seja detectado, o script pode pausar e perguntar se você deseja abrir o navegador para resolver manualmente ou pular a conta (dependendo da configuração interna do menu).

## ⚠️ Disclaimer (Aviso Legal)

**ESTE SOFTWARE FOI DESENVOLVIDO ESTRITAMENTE PARA FINS EDUCACIONAIS E DE TESTES DE SEGURANÇA (PENTESTING) AUTORIZADOS.**

O autor deste repositório não se responsabiliza pelo uso indevido desta ferramenta. O uso deste script para:
1.  Acessar contas de terceiros sem autorização explícita;
2.  Realizar ataques de força bruta, verificação de vazamentos (credential stuffing) ou spam;
3.  Violar os Termos de Serviço do Google ou de provedores de infraestrutura;

...é estritamente proibido e pode constituir crime em diversas jurisdições. Utilize esta ferramenta apenas em dados que lhe pertencem ou para os quais você possui permissão de auditoria.