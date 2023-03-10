#!/usr/bin/env node

const _ = require('lodash');
const axios = require('axios');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const FormData = require('form-data');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const appRoot = require('app-root-path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ejs = require('ejs');
const shell = require('shelljs');
const open = require('open');
const base64url = require('base64-url');
const express = require('express')
const LocalStorage = require('node-localstorage').LocalStorage
const os = require("os");

const SKIP_FILES = ['node_modules'];
const CURR_DIR = process.cwd();

const localStorage = new LocalStorage(`${os.homedir()}/.bx-cli/storage`);
let baseUrl = "https://api.bookletix.com"

yargs(hideBin(process.argv))
    .command('init', 'initial new plugin', (yargs) => {
        return yargs
    }, (argv) => {
        if(_.isNil(argv._[1])) {
            console.log(`
    ${chalk.red.bold('Error')}: ${chalk.red('The project name must be set as the first argument of the')} ${chalk.white.bold('init')} ${chalk.red('command.')}
    ${chalk.white.bold('example:')} ${chalk.gray('bx-cli init my-first-plugin')}
            `);
            return;
        }

        if (!createFolder(argv._[1])) {
            return;
        }

        // print logo
        console.log(logo())

        const CHOICES = fs.readdirSync(path.join(__dirname, 'templates'));
        const QUESTIONS = [
            {
                name: 'name',
                type: 'string',
                message: 'Plugin name:',
            },
            {
                name: 'template',
                type: 'list',
                message: 'What plugin template would you like to generate?',
                choices: CHOICES,
            },
            {
                name: 'description',
                type: 'input',
                message: 'Plugin description:',
                default: 'default plugin description',
            }
        ];

        inquirer.prompt(QUESTIONS)
            .then(answers => {
                answers = Object.assign({}, answers, argv);

                const folderName = argv._[1];
                const pluginTemplate = answers['template'];
                const templPath = path.join(__dirname, 'templates', pluginTemplate);
                const pluginDescription = answers['description'];
                const pluginName = answers['name'];
                const bookletixEmail = answers['bookletixEmail'];
                const bookletixPassword = answers['bookletixPassword'];

                createDirectoryContents(templPath, folderName, {
                    pluginName,
                    folderName,
                    pluginTemplate,
                    pluginDescription,
                    bookletixEmail,
                    bookletixPassword,
                });

                if (!postProcessNode(folderName)) {
                    return;
                }
            });
    })
    .parse()

// auth
yargs(hideBin(process.argv))
    .command('login', 'auth on bookletix.com', (yargs) => {
        return yargs
    }, async (argv) => {
        const app = express();

        const payload = {
            authUrl: "9990",
            expirationTime: ""
        }

        let resolve;
        const p = new Promise((_resolve) => {
            resolve = _resolve;
        });
        app.get('/bxauth', function(req, res) {
            resolve(req.query.at);
            res.redirect(`https://bookletix.com/app/login/`+base64url.encode(JSON.stringify(payload))+`/done`);
            res.end('');
        });
        const server = await app.listen(9990);

        open(`https://bookletix.com/app/login/`+base64url.encode(JSON.stringify(payload))+`/bx-cli`);

        const code = await p;
        await server.close();

        localStorage.setItem('at', code);

        async function getCurrent(at) {
            const instance = axios.create({
                baseURL: baseUrl
            });

            try {
                instance.defaults.headers.common['Authorization'] = "Bearer " + at;
                const response = await instance.get('/v1/users/current', {
                    validateStatus: function (status) {
                        return status === 200;
                    },
                });
                if (response.data.data.email) {
                    return response.data.data.email;
                }
                return null
            } catch (error) {
                throw error;
            }
        }

        let emailResolve;
        const pe = new Promise((_emailResolve) => {
            emailResolve = _emailResolve;
        });
        getCurrent(code).then(async function (email) {
            emailResolve(email);
        })
        const email = await pe;

        console.log(chalk.green(`Logged in successfully ${chalk.yellow.bold(email)}`));
        process.exit(0);
    })
    .parse()

// publish flow
yargs(hideBin(process.argv))
    .command('publish', 'publish plugin on bookletix.com', (yargs) => {
        return yargs
    }, (argv) => {
        if (_.isNil(localStorage.getItem("at"))) {
            console.log(`
                ${chalk.red(`You are not authorized on bookletix.com!`)}
                ${chalk.gray(`run command`)}: ${chalk.white.bold(`npx bx-cli login`)}
            `);

            process.exit(0);
        }

        publish();
    })
    .parse()

function publish() {
    let manifestEntryFile = "manifest.json"

    if (!_.isNil(process.env.API_URL) && process.env.API_URL.length > 0) {
        baseUrl = process.env.API_URL
    }

    if (!_.isNil(process.env.MANIFEST) && process.env.MANIFEST.length > 0) {
        manifestEntryFile = process.env.MANIFEST
    }

    const instance = axios.create({
        baseURL: baseUrl
    });

    async function readContent(fileName) {
        let file = path.join(appRoot.toString(), fileName);
        return await fsp.readFile(file, {encoding: 'utf-8'}).then((data) => {
            return data.toString()
        });
    }

    async function getPluginID(name) {
        try {
            const response = await instance.get('/v1/admin/plugins?page=1&size=1&filter.search=' + encodeURIComponent(name), {
                validateStatus: function (status) {
                    return status === 200;
                }
            });

            if (response.data.data.length > 0) {
                return response.data.data[0].id;
            }

            return null
        } catch (error) {
            throw error;
        }
    }

    async function updatePlugin(id, plugin) {
        try {
            await instance.put('/v1/admin/plugins/' + id, {
                validateStatus: function (status) {
                    return status === 200;
                },
                ...plugin
            });
        } catch (error) {
            throw error;
        }
    }

    async function createPlugin(plugin) {
        try {
            await instance.post('/v1/admin/plugins', {
                validateStatus: function (status) {
                    return status === 200;
                },
                ...plugin
            });
        } catch (error) {
            throw error;
        }
    }

    async function uploadIcon(filename, accessToken) {
        const image = await fsp.readFile(filename);
        const form = new FormData();
        form.append('file', image, filename);

        return await instance.post('/v1/storage/upload', form, {
            headers: {
                ...form.getHeaders(),
            },
        }).then((response) => {
            return response.data.data.name;
        });
    }

    async function login() {
        if (!_.isNil(localStorage.getItem('at'))) {
            return localStorage.getItem('at')
        }

        return ""
    }

    let authFlow = async (accessToken) => {
        instance.defaults.headers.common['Authorization'] = "Bearer " + accessToken;

        let manifestRaw = await readContent(manifestEntryFile)
        let manifest = JSON.parse(manifestRaw);

        let name = await uploadIcon(manifest.icon, accessToken);

        let state = await readContent(manifest.entry.state);
        if (!_.isNil(manifest.state)) {
            state = JSON.stringify(manifest.state)
        }

        let isPublic = false
        if (!_.isNil(manifest.isPublic)) {
            isPublic = manifest.isPublic
        }

        let plugin = {
            status: "active",
            version: manifest.version,
            name: manifest.name,
            cover: name,
            isPublic: isPublic,
            description: manifest.description,
            edit: await readContent(manifest.entry.edit),
            view: await readContent(manifest.entry.view),
            handler: await readContent(manifest.entry.handler),
            tags: manifest.tags,
            settings: JSON.stringify(manifest.settings),
            state: state
        }

        console.log(`
        ${chalk.hex('#9451e6').bold(`booklet${chalk.hex('#E77194').bold('ix')}
        `)}`)

        let t = '\x1b[37mStatus\x1b[0m'
        let tID = '\x1b[37mID\x1b[0m'
        let tName = '\x1b[37mPlugin\x1b[0m'

        getPluginID(manifest.name).then((id) => {
            if (!_.isNil(id)) {
                let sText = "success update"
                let tStatus = '\x1b[32m'+sText+'\x1b[0m'
                updatePlugin(id, plugin).then(() => console.log('\x1b[36m%s\x1b[0m',`
        ${tID}: ${id}
        ${tName}: ${manifest.name}
        ${t}: ${tStatus}
`));
            } else {
                let sText = "success create"
                let tStatus = '\x1b[34m'+sText+'\x1b[0m'
                createPlugin(plugin).then(() => console.log('\x1b[36m%s\x1b[0m',`
        ${tName}: ${manifest.name}
        ${t} ${tStatus}
`));
            }
        });
    }

    login().then(authFlow);
}

function createDirectoryContents(templatePath, folderName, data) {
    const filesToCreate = fs.readdirSync(templatePath);

    filesToCreate.forEach(file => {
        const origFilePath = path.join(templatePath, file);

        // get stats about the current file
        const stats = fs.statSync(origFilePath);

        if (SKIP_FILES.indexOf(file) > -1) return;

        if (stats.isFile()) {
            let contents = fs.readFileSync(origFilePath, 'utf8');

            contents = ejs.render(contents, data);

            if (['_tmp.gitignore'].indexOf(file) > -1) {
                file = file.replace('_tmp', '');
            }

            const writePath = path.join(CURR_DIR, folderName, file);
            fs.writeFileSync(writePath, contents, 'utf8');
        } else if (stats.isDirectory()) {
            fs.mkdirSync(path.join(CURR_DIR, folderName, file));

            // recursive call
            createDirectoryContents(path.join(templatePath, file), path.join(folderName, file), data);
        }
    });
}

function createFolder(folderName) {
    if (fs.existsSync(folderName)) {
        console.log(chalk.red(`Folder ${folderName} exists. Delete or use another name.`));
        return false;
    }

    fs.mkdirSync(folderName);
    return true;
}

function postProcessNode(folderName) {
    console.log(chalk.green(`
    project "${chalk.white.bold(folderName)}" is created!
    
    ${chalk.white.bold(`See examples of real plugins here`)}
    https://github.com/bookletix/plugin-samples
    ${chalk.gray(`(it will help you understand more quickly)`)}
    
    ${chalk.blue.bold('>')} ${chalk.yellow.bold('run')} npm install
    `));

    shell.cd(folderName);

    let cmd = '';
    if (shell.which('npm')) {
        cmd = 'npm install';
    }

    if (cmd) {
        const result = shell.exec(cmd);

        if (result.code !== 0) {
            return false;
        }
    } else {
        console.log(chalk.red('No npm found. Cannot run installation.'));
    }

    return true;
}


function logo() {
    const pur = chalk.hex('#E77194').bold
    return `${chalk.hex('#9451e6').bold(`
    ???                   ???      ??????              ${pur('??????')}           
    ??????            ????????????  ??????     ??????         ??????   ${pur('???')}            
    ??????????????????    ??? ????????? ????????? ??????  ?????? ??????  ??????????????? ???????????????${pur('????????? ??????  ??????')}    
    ??????  ?????????????????????????????????  ?????? ???????????????  ????????????????????? ?????? ??????   ${pur('??????  ????????????')}     
    ??????  ???????????????   ????????????????????? ???????????????  ?????? ????????? ??????  ??????   ${pur('?????? ???????????????')}     
    ??????????????????  ?????????????????? ???    ?????? ????????? ??????  ?????????????????? ????????????${pur('????????? ??????  ??????')}    
             ????????????`)}`
}