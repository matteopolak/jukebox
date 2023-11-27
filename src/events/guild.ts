import { ButtonStyle, Client, ComponentType, GuildTextBasedChannel, PermissionFlagsBits } from 'discord.js';

import { LYRICS_CLIENT, QUEUE_CLIENT } from '@/util/worker';

export function register(client: Client) {
	client.on('guildCreate', async guild => {
		const me = await guild.members.fetchMe();
		const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) as GuildTextBasedChannel | undefined;

		// send a message in the general channel that the other two bots
		// need to be added to the server
		if (channel) {
			channel.send(
				{
					content: `<@${guild.ownerId}> To use this bot, you need to add **${LYRICS_CLIENT.user!.username}** and **${QUEUE_CLIENT.user!.username}** to your server.`,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: 'Add Lyrics Bot',
									style: ButtonStyle.Link,
									url: 'https://discord.com/api/oauth2/authorize?client_id=1010946569866055820&permissions=326417776640&scope=bot%20applications.commands',
								},
								{
									type: ComponentType.Button,
									label: 'Add Queue Bot',
									style: ButtonStyle.Link,
									url: 'https://discord.com/api/oauth2/authorize?client_id=1010945002647597177&permissions=265216&scope=bot%20applications.commands',
								},
							],
						},
					],
				}
			);
		}
	});
}
