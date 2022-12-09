import { Client, MessageType } from 'discord.js';

import Connection from '@/structures/connection';

export function register(client: Client) {
	client.on('messageCreate', async message => {
		if (message.author.bot || !message.inGuild() || message.type !== MessageType.Default) return;

		const connection = await Connection.getOrCreate(message);
		if (!connection) return;

		// wait 1 second before deleting to avoid the glitch where it is
		// still present on the user's client despite it being deleted
		setTimeout(() => message.delete().catch(() => {}), 1000);

		return connection.addSongByQuery(message.content);
	});
}
