# Gnome Wayland Discord Rich Presence

This shows the active window in your Discord status including the application icon

## Features

- Detects the currently active window on Gnome Wayland
- Finds and uploads application icons to Imgur
- Updates Discord Rich Presence with the active application and its icon
- Caches uploaded icons to reduce API calls

## Prerequisites

- Node.js / npm
- A Discord application for Rich Presence
- An Imgur API client ID
- [Window Calls Extended Gnome Extension](https://extensions.gnome.org/extension/4974/window-calls-extended/)

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/0xgingi/gnome-wayland-discord-rpc.git
   cd gnome-wayland-discord-rpc
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `config.json` file in the project root with your Discord and Imgur credentials:
   ```json
   {
     "DISCORD_CLIENT_ID": "your_discord_client_id_here", // I reccomend setting the name as your Distro or something
     "IMGUR_CLIENT_ID": "your_imgur_client_id_here"
   }
   ```

## Usage
```
npm run start
```