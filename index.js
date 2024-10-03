process.noDeprecation = true;

const RPC = require('discord-rpc');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const config = require('./config.json');
const sharp = require('sharp');
const os = require('os');

const execPromise = util.promisify(exec);

const rpc = new RPC.Client({ transport: 'ipc' });

const iconCache = new Map();
let lastActiveWindow = null;

async function getActiveWindow() {
    try {
        const homeDir = os.homedir();
        const { stdout: appClass } = await execPromise(`
            gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/WindowsExt --method org.gnome.Shell.Extensions.WindowsExt.FocusClass
        `);
        
        const fullAppName = appClass.match(/'(.+)'/)[1];
        let simplifiedAppName = fullAppName.split('.').pop().split('-')[0];
        simplifiedAppName = simplifiedAppName.charAt(0).toUpperCase() + simplifiedAppName.slice(1);
                
        const { stdout: desktopFile } = await execPromise(`
            find /usr/share/applications ~/.local/share/applications ${homeDir}/AppImages -iname "*${simplifiedAppName.toLowerCase()}*.desktop" -print -quit
        `);

        if (desktopFile.trim()) {
            
            const { stdout: iconName } = await execPromise(`
                grep '^Icon=' "${desktopFile.trim()}" | cut -d'=' -f2-
            `);
            
            return {
                appName: simplifiedAppName,
                desktopFile: desktopFile.trim(),
                fallbackIconName: iconName.trim()
            };
        } else {
            console.log(`No .desktop file found for ${simplifiedAppName}`);
            return {
                appName: simplifiedAppName,
                desktopFile: '',
                fallbackIconName: ''
            };
        }
    } catch (error) {
        console.error('Error getting active window:', error);
        return null;
    }
}

async function getIconPath(desktopFile, appName) {
    if (!desktopFile && !appName) return null;

    console.log(`Searching for icon for ${appName}`);
    
    const homeDir = os.homedir();
    const iconLocations = [
        `/usr/share/icons/hicolor/512x512/apps/${appName.toLowerCase()}.png`,
        `/usr/share/icons/hicolor/256x256/apps/${appName.toLowerCase()}.png`,
        `/usr/share/icons/hicolor/128x128/apps/${appName.toLowerCase()}.png`,
        `/usr/share/icons/hicolor/64x64/apps/${appName.toLowerCase()}.png`,
        `/usr/share/pixmaps/${appName.toLowerCase()}.png`,
        `/usr/share/icons/${appName.toLowerCase()}.png`,
        `/opt/${appName.toLowerCase()}/${appName.toLowerCase()}.png`,
        `~/.local/share/icons/${appName.toLowerCase()}.png`,
        `/usr/share/icons/hicolor/128x128/apps/${appName.toLowerCase()}-browser.png`,
        `${homeDir}/AppImages/.icons/${appName.toLowerCase()}.png`,
    ];

    for (const location of iconLocations) {
        console.log(`Checking location: ${location}`);
        try {
            await fs.access(location);
            console.log(`Found icon at: ${location}`);
            return location;
        } catch (error) {
        }
    }

    if (desktopFile) {
        try {
            console.log(`Checking .desktop file: ${desktopFile}`);
            const desktopFileContent = await fs.readFile(desktopFile, 'utf-8');
            const iconLine = desktopFileContent.split('\n').find(line => line.startsWith('Icon='));
            if (iconLine) {
                const iconName = iconLine.split('=')[1].trim();
                console.log(`Extracted icon name from .desktop file: ${iconName}`);
                
                const { stdout: iconPath } = await execPromise(`
                    find /usr/share/icons /usr/share/pixmaps ~/.local/share/icons -type f \\( -name "${iconName}.png" -o -name "${iconName}.svg" -o -name "${iconName}.xpm" \\) -print -quit
                `);
                
                if (iconPath.trim()) {
                    console.log(`Found icon path: ${iconPath.trim()}`);
                    return iconPath.trim();
                }
            }
        } catch (error) {
            console.error('Error reading .desktop file:', error);
        }
    }

    try {
        console.log(`Using gio info to find icon for ${desktopFile}`);
        const { stdout: iconInfo } = await execPromise(`
            gio info -a "standard::icon" "${desktopFile}"
        `);
        console.log(`gio info output: ${iconInfo.trim()}`);
        
        const iconNamesMatch = iconInfo.match(/standard::icon:\s*(.*)/);
        if (iconNamesMatch) {
            const iconNames = iconNamesMatch[1].split(',').map(name => name.trim());
            console.log(`Extracted icon names: ${iconNames.join(', ')}`);
            
            for (const iconName of iconNames) {
                console.log(`Searching for icon: ${iconName}`);
                
                const { stdout: iconPath } = await execPromise(`
                    find /usr/share/icons ~/.local/share/icons /usr/share/pixmaps -type f \\( -name "${iconName}.png" -o -name "${iconName}.svg" -o -name "${iconName}.xpm" \\) -print -quit
                `);
                
                if (iconPath.trim()) {
                    console.log(`Found icon path: ${iconPath.trim()}`);
                    return iconPath.trim();
                }
            }
        }
    } catch (error) {
        console.error('Error getting icon path:', error);
    }

    console.log(`No icon file found for ${appName}`);
    return null;
}

async function uploadToImgur(iconPath) {
    if (iconCache.has(iconPath)) {
        console.log(`Using cached Imgur URL for ${iconPath}`);
        return iconCache.get(iconPath);
    }

    try {
        let imageBuffer = await fs.readFile(iconPath);
        let contentType = 'image/png';

        if (path.extname(iconPath).toLowerCase() !== '.png') {
            console.log(`Converting ${iconPath} to PNG`);
            imageBuffer = await sharp(imageBuffer)
                .png()
                .toBuffer();
        }

        const form = new FormData();
        form.append('image', imageBuffer, {
            filename: 'icon.png',
            contentType: contentType
        });

        const response = await axios.post('https://api.imgur.com/3/image', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Client-ID ${config.IMGUR_CLIENT_ID}`
            }
        });

        if (response.data && response.data.success && response.data.data.link) {
            const imageUrl = response.data.data.link;
            console.log(`Successfully uploaded to Imgur: ${imageUrl}`);
            iconCache.set(iconPath, imageUrl);
            return imageUrl;
        } else {
            console.error('Unexpected Imgur API response structure');
            return null;
        }
    } catch (error) {
        console.error('Error uploading to Imgur:', error.message);
        if (error.response) {
            console.error('Imgur API error response:', JSON.stringify(error.response.data, null, 2));
        }
        return null;
    }
}

const updateActivity = async () => {
    try {
        const window = await getActiveWindow();
        if (window && window.appName) {
            if (!lastActiveWindow || lastActiveWindow.appName !== window.appName) {
                console.log(`Window changed. Updating activity for ${window.appName}`);
                let iconPath = await getIconPath(window.desktopFile, window.appName);
                
                let activityOptions = {
                    details: `Using ${window.appName}`,
                    instance: false,
                };

                if (iconPath) {
                    let iconUrl;
                    if (iconCache.has(iconPath)) {
                        iconUrl = iconCache.get(iconPath);
                    } else {
                        iconUrl = await uploadToImgur(iconPath);
                    }
                    
                    if (iconUrl) {
                        activityOptions.largeImageKey = iconUrl;
                        activityOptions.largeImageText = window.appName;
                    }
                }

                rpc.setActivity(activityOptions);
                console.log(`Updated activity: ${window.appName}`);
                lastActiveWindow = window;
            } else {
            }
        } else if (lastActiveWindow) {
            console.log('No active window detected. Clearing activity.');
            rpc.clearActivity();
            lastActiveWindow = null;
        }
    } catch (error) {
        console.error('Error updating activity:', error);
        rpc.clearActivity();
        lastActiveWindow = null;
    }
};

rpc.on('ready', () => {
    console.log('Discord RPC Ready!');
    updateActivity();
    setInterval(updateActivity, 5000);
});

rpc.login({ clientId: config.DISCORD_CLIENT_ID }).catch(console.error);