<p align="center">
  <img height="128" width="384" src="https://github.com/matteopolak/jukebox/blob/main/readme_assets/logo.png">
</p>

![Build Status](https://github.com/matteopolak/jukebox/actions/workflows/ci.yml/badge.svg)
[![License:MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Jukebox](https://github.com/matteopolak/jukebox) is a Discord bot that plays music in voice channels from Spotify, YouTube, Apple Music, and SoundCloud.

⚠️ To abide by Discord and YouTube ToS, playing copyrighted content from YouTube is strictly forbidden and I am not responsible for any consequences taken against you.

## Features

* 16 audio effects
* Supports 3 major music providers
  * **Spotify** albums, playlists, and singles
  * **YouTube** playlists and singles
  * **Apple Music** albums, playlists, and singles
  * **SoundCloud** albums, playlists, and singles
* Dedicated channel to request and control music
* Support for playing restricted YouTube content
* Voice commands with Wit.ai

### Commands

* `/chart <name> [play]`
  * Adds a Spotify chart playlist the the queue.
  * `name`
    * The name of the chart to add.
  * `play`
    * Whether to play the result immediately.
* `/create`
  * Creates a new audio player in the current channel.
* `/invite`
  * Provides an invite link for the bot.
* `/play <query>`
  * Plays the result of the query immediately.
  * `query`
    * Any query, such as a link or search term.
* `/playlist <title> [play]`
  * Adds a playlist to the queue.
  * `title`
    * The title of the playlist.
  * `play`
    * Whether to play the result immediately.

### Voice commands

⚠️ Voice commands are enabled by default. To disable them, **Server Deafen** the bot.

* `"hey bot play <query>"`
  * Adds a song to the playlist.
  * `query`
    * The name of the song.
* `"hey bot pause"`
  * Pauses the current track.
* `"hey bot resume"`
  * Resumes the current track.
* `"hey bot skip"`
  * Skips the current track.
* `"hey bot previous"`
  * Plays the previous track.
* `"hey bot autoplay"`
  * Toggles autoplay mode.
* `"hey bot shuffle"`
  * Toggles shuffle mode.
* `"hey bot repeat"`
  * Toggles repeat between three modes: **Repeat One**, **Repeat**, and **None**

## Installation and usage

With yarn:

```bash
# install dependencies
yarn install
yarn run build

# start the bot
node build/index.js
```

With npm:

```bash
# install dependencies
npm install
npm run build

# start the bot
node build/index.js
```

## Screenshots

Coming soon...
