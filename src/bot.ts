import rbx from 'noblox.js';
import axios from 'axios';
import { Client, Collection, MessageEmbed } from 'discord.js';
import dotenv from 'dotenv';
import Exile from './models/userExile';
import Words from './models/wordOrPhrase';
import timedata from './models/suspendTimes';
import postDeletions from './models/deletions';
import { DeletionTypes } from './types/deletions';

dotenv.config();

const RbxToken = process.env.RobloxTest === 'true' ? process.env.ROBLOX_TESTTOKEN : process.env.ROBLOX_TOKEN;
let botUsername = '';

const bot: any = new Client({
  ws: { intents: ['GUILD_MESSAGES', 'GUILDS', 'GUILD_MESSAGE_REACTIONS', 'GUILD_MEMBERS', 'GUILD_PRESENCES', 'GUILD_BANS'] },
  partials: ['USER'],
  disableMentions: 'everyone',
});

bot.commands = new Collection();
bot.aliases = new Collection();

['commands', 'aliases'].forEach((collection: string) => {
  bot[collection] = new Collection();
});
['loadCommands', 'loadEvents'].forEach((handlerFile: string) => require(`./handlers/${handlerFile}.js`)(bot));

async function startApp() {
  try {
    await rbx.setCookie(String(RbxToken));
  } catch (err) {
    let noBot = true;

    bot.channels.cache
      .get(process.env.GEN_STAFF)
      .messages.fetch({ limit: 10 })
      .then((msg: any) => {
        msg.array().forEach((fectchedMsg: any) => {
          if (fectchedMsg.author.bot) noBot = false;
        });
        if (noBot === true) {
          return bot.channels.cache.get(process.env.GEN_STAFF).send("Hello there!\n\nIt appears I'm currently experiencing issues logging into the **Roblox Account** at the moment. Due to this, I won't be able to run any of your commands, and my features will be non-functional. <:mascotsad:658685980273803274>\n\nHowever don't fret, in the meantime, I'll be automatically restarting at random intervals with the hope of logging in successfully. You may see me head offline too, this is intended, don't worry! I'll be back up and running soon!");
        }
      });
  }

  try {
    botUsername = (await rbx.getCurrentUser()).UserName;
    console.log(`[SUCCESS]: Logged into the "${botUsername}" Roblox account!`);
  } catch (err) {
    setTimeout(() => {
      console.log(err);
    }, 2000);
  }

  async function SuspendAndExile(): Promise<void> {
    const data = timedata.find({}).select('RobloxName RobloxID timestamp Role Duration');
    const user = Exile.find({}).select('RobloxUsername RobloxID Moderator Reason');
    let rank: number;

    /* --- Suspending --- */
    (await data).forEach(async (player) => {
      /* --- If suspended and time hasn't expired --- */
      rank = await rbx.getRankInGroup(Number(process.env.GROUP), player.RobloxID);

      if (player.timestamp.getTime() + player.Duration > Date.now()) {
        try {
          if (rank !== 0) {
            if (rank !== 8) await rbx.setRank(Number(process.env.GROUP), player.RobloxID, 8);
          }
        } catch (err) {
          return;
        }
      } else {
        // -- Reranking player and removing document ---
        bot.channels.cache.get(process.env.ADMIN_LOG).send(
          new MessageEmbed() //
            .setTitle(`✅ Suspension Expired!`)
            .setColor('#7289DA')
            .setDescription(`**${player.RobloxName}'s suspension has concluded.**`)
            .setFooter(`Suspended Player ID: ${player.RobloxID} `)
            .setTimestamp()
        );

        if (rank !== 0) {
          try {
            await rbx.setRank(Number(process.env.GROUP), player.RobloxID, player.Role);
          } catch (err) {
            return;
          }
        }

        await timedata.deleteOne({ RobloxID: player.RobloxID });
      }
    });

    (await user).forEach(async (player: { RobloxID: any; RobloxUsername: String; Moderator: String; Reason: String }) => {
      try {
        if (rank !== 0) {
          await rbx.exile(Number(process.env.GROUP), player.RobloxID);
        }
      } catch (err) {
        return;
      }
    });
  }

  setInterval(SuspendAndExile, 7000);

  const wallPost = rbx.onWallPost(Number(process.env.GROUP));
  const auditLog = rbx.onAuditLog(Number(process.env.GROUP));

  wallPost.on('connect', () => {
    console.log('[SUCCESS]: Listening for new wall posts!');
  });

  wallPost.on('data', async (post) => {
    const robloxName: string = Object.values(post.poster)[0].username;
    const robloxID: number = Object.values(post.poster)[0].userId;
    let blacklistedWord: string = '';
    let noDeletes = true;
    let warnable = true;

    const blacklisted = await Words.find({}).select('content Warnable');

    // -- Ignoring Staff
    if ((await rbx.getRankInGroup(Number(process.env.GROUP), robloxID)) >= 20) return;

    // -- Deleting content that is just hashtags/one letter spam
    if (/^(.)\1+$/.test(post.body.replace(/\s+/g, '')) === true) {
      try {
        return await rbx.deleteWallPost(Number(process.env.GROUP), post.id);
      } catch (err) {
        return;
      }
    }

    blacklisted.forEach(async (word: any) => {
      if (post.body.toLowerCase().includes(word.content)) {
        blacklistedWord = word.content;
        noDeletes = false;
        if (word.Warnable === false) warnable = false;
        try {
          await rbx.deleteWallPost(Number(process.env.GROUP), post.id);
        } catch (err) {
          return;
        }
      }
    });

    if (noDeletes === true) return;

    const log = new MessageEmbed() //
      .setTitle(`:warning: Post deleted!`)
      .setColor('#FFD62F')
      .setDescription(`**${robloxName}'s post was deleted automatically by SaikouGroup**`)
      .addField('Deleted Message:', post.body)
      .addField('Deletion Reason:', `Post included the word/phrase **${blacklistedWord}** which is blacklisted.`)
      .setFooter(`Deleted Post Player ID: ${robloxID} `)
      .setTimestamp();

    const suspension = new MessageEmbed() //
      .setTitle(`:warning: Automatic Suspension!`)
      .setColor('#FFD62F')
      .setDescription(`**${robloxName}'s was suspended automatically by SaikouGroup**`)
      .addField('Deleted Message:', post.body)
      .setFooter(`Suspended Player ID: ${robloxID} `)
      .setTimestamp();

    const creation = {
      RobloxName: robloxName,
      RobloxID: robloxID,
      timestamp: new Date(),
      Role: await rbx.getRankNameInGroup(Number(process.env.GROUP), robloxID),
      Moderator: 'SaikouGroup',
    };

    await postDeletions.findOne({ RobloxName: robloxName }, async (err: any, postDeleted: DeletionTypes) => {
      if (err) return console.error(err);

      if (!postDeleted) {
        const newData = await postDeletions.create({ RobloxName: robloxName, RobloxID: robloxID, Triggers: 1 });
        await newData.save();

        return bot.channels.cache.get(process.env.ADMIN_LOG).send(log);
      }

      if (warnable === true) {
        // eslint-disable-next-line no-param-reassign
        postDeleted.Triggers += 1;
        await postDeleted.save();
      }

      switch (postDeleted.Triggers) {
        case 3:
          Object.assign(creation, { Duration: 259200000, Reason: '**[Automated]** Player posted 3 blacklisted posts.' });
          (await timedata.create(creation)).save();

          suspension.addField('Suspension Duration:', '3 days');
          suspension.addField('Suspension Reason:', 'Player posted 3 blacklisted posts.');

          bot.channels.cache.get(process.env.ADMIN_LOG).send(suspension);
          break;

        case 5:
          Object.assign(creation, { Duration: 604800000, Reason: '**[Automated]** Player posted 5 blacklisted posts.' });
          (await timedata.create(creation)).save();

          suspension.addField('Suspension Duration:', '7 days');
          suspension.addField('Suspension Reason:', 'Player posted 5 blacklisted posts.');

          bot.channels.cache.get(process.env.ADMIN_LOG).send(suspension);
          break;

        case 7:
          (
            await Exile.create({
              Moderator: 'SaikouGroup',
              Reason: '**[Automated]** Player posted 7 blacklisted posts before/after suspensions.',
              RobloxUsername: robloxName,
              RobloxID: robloxID,
            })
          ).save();

          await axios({
            url: `https://groups.roblox.com/v1/groups/${process.env.GROUP}/wall/users/${robloxID}/posts`,
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-TOKEN': await rbx.getGeneralToken(),
              Cookie: `.ROBLOSECURITY=${RbxToken}`,
            },
          });
          bot.channels.cache.get(process.env.ADMIN_LOG).send(log);
          break;

        default:
          return bot.channels.cache.get(process.env.ADMIN_LOG).send(log);
      }
    });
  });

  wallPost.on('error', () => undefined);

  // -- Change Rank logs
  wallPost.on('connect', () => {
    console.log('[SUCCESS]: Listening for new audit logs!');
  });

  auditLog.on('data', async (data) => {
    if (data.actionType === 'Change Rank') {
      if (data.actor.user.username === botUsername) return;
      bot.channels.cache.get(process.env.ADMIN_LOG).send(
        new MessageEmbed() //
          .setTitle(`:warning: Updated Role!`)
          .setColor('#FFD62F')
          .setDescription(`**${Object.values(data.description)[3]}'s role was updated by ${data.actor.user.username}**`)
          .addField('Old Role:', Object.values(data.description)[4])
          .addField('New Role:', Object.values(data.description)[5])
          .setFooter(`Updated User ID: ${Object.values(data.description)[0]} `)
          .setTimestamp()
      );
    }

    if (data.actionType === 'Remove Member') {
      const user = await Exile.findOne({ RobloxUsername: Object.values(data.description)[1] });
      if (user) {
        bot.channels.cache.get(process.env.ADMIN_LOG).send(
          new MessageEmbed() //
            .setTitle(`:warning: Automatic Exile!`)
            .setColor('#FFD62F')
            .setDescription(`**${Object.values(data.description)[1]} was exiled automatically by ${data.actor.user.username}**`)
            .addField('Exile Giver:', `${user.Moderator}`)
            .addField('Exile Reason:', `${user.Reason}`)
            .setFooter(`Exiled User ID: ${Object.values(data.description)[0]} `)
            .setTimestamp()
        );
      } else {
        bot.channels.cache.get(process.env.ADMIN_LOG).send(
          new MessageEmbed() //
            .setTitle(`:warning: Exiled User!`)
            .setColor('#FFD62F')
            .setDescription(`**${Object.values(data.description)[1]}'s was exiled by ${data.actor.user.username}**`)
            .setFooter(`Exiled User ID: ${Object.values(data.description)[0]} `)
            .setTimestamp()
        );
      }
    }
  });

  auditLog.on('error', () => undefined);
}

startApp();

bot.login(process.env.TEST === 'true' ? process.env.DISCORD_TESTTOKEN : process.env.DISCORD_TOKEN);
