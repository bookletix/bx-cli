#!/usr/bin/env node

const dotenv = require('dotenv');
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

const SKIP_FILES = ['node_modules'];
const CURR_DIR = process.cwd();

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
            },
            {
                name: 'answerRequired',
                type: 'boolean',
                message: 'Is answer required?',
                validate: (input) => {
                    if (/^(true|false)$/.test(input)) return true;
                    else return 'put true or false';
                },
                default: false,
            },
            {
                name: 'bookletixEmail',
                type: 'string',
                validate: (input) => {
                    if (/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(input)) return true;
                    else return 'You entered a wrong email';
                },
                message: 'Bookletix account login(email):',
            },
            {
                name: 'bookletixPassword',
                type: 'password',
                message: 'Bookletix account password:',
            },
        ];

        inquirer.prompt(QUESTIONS)
            .then(answers => {
                answers = Object.assign({}, answers, argv);

                const folderName = argv._[1];
                const pluginTemplate = answers['template'];
                const templPath = path.join(__dirname, 'templates', pluginTemplate);
                const pluginDescription = answers['description'];
                const pluginName = answers['name'];
                const answerRequired = answers['answerRequired'];
                const bookletixEmail = answers['bookletixEmail'];
                const bookletixPassword = answers['bookletixPassword'];

                createDirectoryContents(templPath, folderName, {
                    pluginName,
                    folderName,
                    pluginTemplate,
                    pluginDescription,
                    answerRequired,
                    bookletixEmail,
                    bookletixPassword,
                });

                if (!postProcessNode(folderName)) {
                    return;
                }
            });
    })
    .parse()

// publish flow
yargs(hideBin(process.argv))
    .command('publish', 'publish plugin on bookletix.com', (yargs) => {
        return yargs
    }, (argv) => {
        const result = dotenv.config();
        if (result.error) {
            throw result.error;
        }

        let email = process.env.EMAIL;
        let password = process.env.PASSWORD;

        if (!_.isNil(argv.email)) {
            email = argv.email
        }

        if (!_.isNil(argv.password)) {
            password = argv.password
        }

        if (_.isNil(email) || _.isNil(password)) {
            throw "email or password is required";
        }

        console.log(logo())

        publish(email, password);
    })
    .option('email', {
        alias: 'e',
        type: 'string',
        description: 'bookletix.com user email'
    })
    .option('password', {
        alias: 'e',
        type: 'string',
        description: 'bookletix.com user password'
    })
    .parse()

function publish(email, password) {
    let baseUrl = "https://api.bookletix.com"
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

    async function login(email, password) {
        try {
            const response = await instance.post('/v1/admin/users/login', {
                validateStatus: function (status) {
                    return status === 200;
                },
                email: email,
                password: password
            });

            if (!_.isNil(response.data.data.accessToken)) {
                return response.data.data.accessToken
            }

            return "";
        } catch (error) {
            throw error;
        }
    }

    if (_.isNil(process.env.EMAIL) || _.isNil(process.env.PASSWORD)) {
        console.log(chalk.red(`There is no email or password field in the .env file`));
        return;
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

    login(email, password).then(authFlow);
}

function logo() {
    const pur = chalk.hex('#E77194').bold
    return `${chalk.hex('#9451e6').bold(`
    ▗                   ▗      ▗▗              ${pur('▖▖')}           
    ▌▌            ▖▄▗▗  ▚▜     ▐▐         ▖▌   ${pur('▘')}            
    ▌▙▐▐▗▖    ▗ ▗▜▝ ▘▌▌ ▚▚  ▄▄ ▐▐  ▗▖▌▄▖ ▄▚▜▄▖${pur('▗▗▖ ▄▗  ▖▖')}    
    ▞▞  ▝▞▖▗▐▞▘▀▞▞▖  ▞▞ ▌▙▗▚▘  ▐▞▖▗▚▘▗ ▌▌ ▞▄   ${pur('▌▖  ▚▗▚▝')}     
    ▌▙  ▝▞▌▐▐   ▚▚▚▖▞▞▝ ▞▞▝▞▄  ▞▞ ▗▚▀ ▘▘  ▞▞   ${pur('▌▖ ▗▗▚▝▖')}     
    ▚▘▚▚▜▝  ▌▌▖▖▌▌ ▝    ▞▞ ▝▝▜ ▐▐  ▘▜▐▐▝▘ ▝▞▌▄${pur('▝▖▘ ▚▘  ▘▌')}    
             ▘▘▘▘`)}`
}