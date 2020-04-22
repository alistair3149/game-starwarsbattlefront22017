const Promise = require('bluebird');
const path = require('path');
const { actions, fs, FlexLayout, selectors, log, util } = require('vortex-api');
const winapi = require('winapi-bindings');

const React = require('react');
const BS = require('react-bootstrap');

const IniParser = require('vortex-parse-ini');

// Nexus Mods id for the game.
const GAME_ID = 'starwarsbattlefront22017';

// All SWBF2 mods will be .fbmod files
const MOD_FILE_EXT = ".fbmod";
const FROSTY_PATH = 'FrostyModManager';
const MOD_PATH = path.join(FROSTY_PATH, 'Mods', 'StarWarsBattlefrontII');
const FROSTY_EXEC = 'FrostyModManager.exe';
const FROSTY_ID = 'FrostyModManager';
const FROSTY_CONFIG_FILENAME = 'FrostyModManager starwarsbattlefrontii.ini';
const DEPLOYMENT_MANIFEST = path.join(MOD_PATH, 'vortex.deployment.json');
const I18N_NAMESPACE = 'game-starwarsbattlefront22017';
let _INI_STRUCT = {};

const tools = [{
    id: 'FrostyModManagerLaunch',
    name: 'Launch Modded Game',
    logo: 'gameart.png',
    executable: () => FROSTY_EXEC,
    isPrimary: true,
    requiredFiles: [FROSTY_EXEC, ],
    relative: true,
    exclusive: true,
    parameters: ['-launch default', ],
}, {
    id: FROSTY_ID,
    name: 'Frosty Mod Manager',
    logo: 'frosty.png',
    executable: () => FROSTY_EXEC,
    requiredFiles: [FROSTY_EXEC, ],
    relative: true,
    exclusive: true,
}];

function getLoadOrderFilePath(context) {
    const state = context.api.store.getState();
    const discovery = util.getSafe(state, ['settings', 'gameMode', 'discovered', GAME_ID], undefined);

    return path.join(discovery.path, FROSTY_PATH, FROSTY_CONFIG_FILENAME);
}

/*
// WIP copypasta from Witcher 3
function writeToModSettings() {
          const filePath = getLoadOrderFilePath();
          const parser = new IniParser.default(new IniParser.WinapiFormat());
          return fs.removeAsync(filePath).then(() => fs.writeFileAsync(filePath, '', { encoding:'utf8' }))
            .then(() => parser.read(filePath)).then(ini => {
              return Promise.each(Object.keys(_INI_STRUCT), (key) => {
                ini.data[key] = {
                  Enabled: '1',
                  Priority: _INI_STRUCT[key].Priority,
                  VK: _INI_STRUCT[key].VK,
                }
                return Promise.resolve();
              })
              .then(() => parser.write(filePath, ini));
            });
}
*/

// Attempts to parse and return data found inside
//  the frosty configuration file if found - otherwise this
//  will ensure the file is present.
function ensureModSettings(context) {
    const filePath = getLoadOrderFilePath(context);
    const parser = new IniParser.default(new IniParser.WinapiFormat());

    return fs.statAsync(filePath).then(() => parser.read(filePath)).catch(err => (err.code === 'ENOENT') ? fs.writeFileAsync(filePath, '', {
        encoding: 'utf8'
    }).then(() => parser.read(filePath)) : Promise.reject(err));
}

function getFrostyConfig(context) {
    return ensureModSettings(context).then(ini => {
        // Whole INI config file in array
        const iniConfig = Object.entries(ini.data);
        // This is hard-coded and need some help to fix it up
        const iniProfiles = iniConfig[1][1];
        // [Profiles] >> Default
        // const iniProfileName = Object.getOwnPropertyNames(iniProfiles)[0]; - To obtain profile name
        const iniLoadOrder = iniProfiles.Default;
        const regexLoadOrder = /([^:,\|]+):([^|]+)/g;
        const extractLoadOrder = [...iniLoadOrder.matchAll(regexLoadOrder)];
        const iniEntries = [];

        for (const modEntry of extractLoadOrder) {
            iniEntries.push(modEntry[1]);
        }

        return iniEntries;
    }).catch(err => {
        context.api.showErrorNotification('Failed to lookup manually added mods', err)
        return Promise.resolve([]);
    });
}

async function getAllMods(context) {
    const frostyMods = await getFrostyConfig(context);

    return Promise.resolve([].concat(frostyMods));
}

/*
// WIP copypasta from Witcher 3
async function setINIStruct(context, loadOrder) {
    let nextAvailableIdx = Object.keys(loadOrder).length;
    const getNextIdx = () => {
        return nextAvailableIdx++;
    }
    return getAllMods(context).then(mods => {
        _INI_STRUCT = {};
        return Promise.each(mods, mod => {
            let name;
            let key;
            if (typeof(mod) === 'object' && mod !== null) {
                name = mod.name;
                key = mod.id;
            } else {
                name = mod;
                key = mod;
            }

            _INI_STRUCT[name] = {
                Enabled: '1',
                Priority: util.getSafe(loadOrder, [key], undefined) !== undefined ? loadOrder[key].pos + 1 : getNextIdx(),
                VK: key,
            };
        });
    })
}
*/

async function refreshGameParams(context, loadOrder) {
    return Promise.resolve();
}

async function preSort(context, items, direction) {
    const frostyMods = await getFrostyConfig(context);
    const state = context.api.store.getState();
    const vortexMods = util.getSafe(state, ['persistent', 'mods', GAME_ID], []);
    const activeProfile = selectors.activeProfile(state);
    const loadOrder = util.getSafe(state, ['persistent', 'loadOrder', activeProfile.id], {})

    if (frostyMods.length === 0) {
        return [];
    }

    const manualEntries = frostyMods.filter(key => (items.find(item => item.id === key) === undefined)).map(key => ({
        id: key,
        name: key,
        imgUrl: `${__dirname}/gameart.png`,
    }));

    const preSorted = [].concat(manualEntries, items);

    return (direction === 'descending') ? Promise.resolve(preSorted.reverse()) : Promise.resolve(preSorted);
}

function findGame() {
    const instPath = winapi.RegGetValue('HKEY_LOCAL_MACHINE', 'Software\\Wow6432Node\\EA Games\\STAR WARS Battlefront II', 'Install Dir');
    if (!instPath) {
        throw new Error('empty registry key');
    }
    return Promise.resolve(instPath.value);
}

function prepareForModding(context, discovery) {
    // TODO: Better way to install Frosty?
    const notifId = 'missing-frosty';
    const api = context.api;
    const missingFrosty = () => api.sendNotification({
        id: notifId,
        type: 'info',
        message: api.translate('Frosty Mod Manager not detected', {
            ns: I18N_NAMESPACE
        }),
        allowSuppress: true,
        actions: [{
            title: 'More',
            action: () => {
                api.showDialog('info', 'Frosty Mod Manager is missing', {
                    bbcode: api.translate('Vortex is unable to find Frosty Mod Manager. ' + 'Please ensure that Frosty Mod Manager is installed in the FrostModManager ' + 'folder under the game directory.', {
                        ns: I18N_NAMESPACE
                    }),
                }, [{
                    label: 'Cancel',
                    action: () => {
                        api.dismissNotification('missing-frosty');
                    }
                }, {
                    label: 'Download Frosty Mod Manager',
                    action: () => util.opn('https://frostytoolsuite.com/downloads.html').catch(err => null).then(() => api.dismissNotification('missing-frosty'))
                }, ]);
            },
        }, ],
    });

    const frostyPath = util.getSafe(discovery, ['tools', FROSTY_ID, 'path'], undefined);
    const findFrosty = () => {
        return (frostyPath !== undefined) ? fs.statAsync(frostyPath).catch(() => missingFrosty()) : missingFrosty();
    };
    return fs.ensureDirAsync(path.join(discovery.path, MOD_PATH)).tap(() => findFrosty());
}

function installContent(files) {
    // The .fbmod file is expected to always be positioned in the mods directory we're going to disregard anything placed outside the root.
    const modFile = files.find(file => path.extname(file).toLowerCase() === MOD_FILE_EXT);
    const idx = modFile.indexOf(path.basename(modFile));
    const rootPath = path.dirname(modFile);

    // Remove directories and anything that isn't in the rootPath.
    const filtered = files.filter(file => ((file.indexOf(rootPath) !== -1) && (!file.endsWith(path.sep))));

    const instructions = filtered.map(file => {
        return {
            type: 'copy',
            source: file,
            destination: path.join(file.substr(idx)),
        };
    });

    return Promise.resolve({
        instructions
    });
}

function testSupportedContent(files, gameId) {
    // Make sure we're able to support this mod.
    let supported = (gameId === GAME_ID) && (files.find(file => path.extname(file).toLowerCase() === MOD_FILE_EXT) !== undefined);

    // Test for a mod installer.
    if (supported && files.find(file => (path.basename(file).toLowerCase() === 'moduleconfig.xml') && (path.basename(path.dirname(file)).toLowerCase() === 'fomod'))) {
        supported = false;
    }

    return Promise.resolve({
        supported,
        requiredFiles: [],
    });
}

function infoComponent(context, props) {
    const t = context.api.translate;
    return React.createElement(BS.Panel, {
        id: 'loadorderinfo'
    }, React.createElement('h2', {}, t('Managing your load order', {
        ns: I18N_NAMESPACE
    })), React.createElement(FlexLayout.Flex, {}, React.createElement('p', {}, t('You can adjust the load order for Battlefront II by dragging and dropping mods up and down on this page. ' + 'This load order is identical to the load order of Frosty Mod Manager. ' + 'Any changes made on both Vortex and Frosty will change the actual load order on both sides. ' + 'Please consult the individual mod pages for compatiblity issues between mods.', {
        ns: I18N_NAMESPACE
    }), )), React.createElement(BS.Button, {
        onClick: props.refresh
    }, t('Refresh')));
}

function main(context) {
    // Register game extension
    context.registerGame({
        id: GAME_ID,
        name: 'Star Wars: Battlefront II (2017)',
        mergeMods: true,
        queryPath: findGame,
        queryModPath: () => MOD_PATH,
        logo: 'gameart.png',
        executable: () => 'starwarsbattlefrontii.exe',
        setup: (discovery) => prepareForModding(context, discovery),
        supportedTools: tools,
        requiredFiles: ['starwarsbattlefrontii.exe'],
    });

    context.registerInstaller('starwarsbattlefront22017-mod', 25, testSupportedContent, installContent);

    // Register load order page
    let previousLO = {};
    context.registerLoadOrderPage({
        gameId: GAME_ID,
        createInfoPanel: (props) => infoComponent(context, props),
        gameArtURL: `${__dirname}/gameart.png`,
        preSort: (items, direction) => preSort(context, items, direction),
        callback: (loadOrder) => refreshGameParams(context, loadOrder),
    });
    /*
    context.once(() => {
        // Run on deploy mods
        context.api.onAsync('did-deploy', (profileId, deployment) => {
            const state = context.api.store.getState();
            const vortexMods = util.getSafe(state, ['persistent', 'mods', GAME_ID], []);
            const activeProfile = selectors.activeProfile(state);
            const loadOrder = util.getSafe(state, ['persistent', 'loadOrder', activeProfile.id], {})

            const deployedMods = {};

            for (const deploymentEntry of deployment[""]) {
                const modId = deploymentEntry["source"];
                const modFileName = path.basename(deploymentEntry["relPath"]);

                // Map mod filename and ID into an object
                deployedMods[modId] = {};
                deployedMods[modId].fileName = modFileName;

                // Rewrite loadOrder
                if (loadOrder[modFileName] && loadOrder[modFileName].pos)
                    loadOrder[modFileName].pos -= Object.keys(vortexMods).length;
                delete loadOrder[modId];
            }

            context.api.store.dispatch(actions.setLoadOrder(activeProfile.id, loadOrder));
            return refreshGameParams(context, loadOrder);
        });
    });
    */
    return true;
}

module.exports = {
    default: main,
};