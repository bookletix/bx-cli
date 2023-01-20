#!/usr/bin/env node

const dotenv = require('dotenv');
const _ = require('lodash');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const FormData = require('form-data');
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

yargs(hideBin(process.argv))
    .command('publish', 'publish plugin', (yargs) => {
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

        publish(email, password)
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
        let file = path.join(__dirname, fileName);
        return await fs.readFile(file, {encoding: 'utf-8'}).then((data) => {
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
        const image = await fs.readFile(filename);
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
        throw "There is no email or password field in the .env file";
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

        let plugin = {
            status: "active",
            version: manifest.version,
            name: manifest.name,
            cover: name,
            description: manifest.description,
            edit: await readContent(manifest.entry.edit),
            view: await readContent(manifest.entry.view),
            handler: await readContent(manifest.entry.handler),
            tags: manifest.tags,
            settings: JSON.stringify(manifest.settings),
            state: state
        }

        getPluginID(manifest.name).then((id) => {
            if (!_.isNil(id)) {
                updatePlugin(id, plugin).then(() => console.log("success update"));
            } else {
                createPlugin(plugin).then(() => console.log("success create"));
            }
        });
    }

    login(email, password).then(authFlow);
}