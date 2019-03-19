import yargs from "yargs";
import DataBase from "./db";

const argv = yargs
  .option("archive", {
    describe: "the path to the archive directory",
  })
  .option("base-url", {
    describe: "the base URL underwhich the archive directory is available",
  })
  .option("feed-name", {
    describe: "the name of the feed",
  })
  .option("feed-url", {
    describe: "the URL of the RSS/XML feed",
  })
  .option("just-mp3", {
    describe: "only update episode MP3 files",
  })
  .command(
    "init",
    "initialize a podcast archive directory",
    (y) => y.demandOption(["archive", "base-url"]),
    init)
  .command(
    "add",
    "add a new podcast feed to be tracked",
    (y) => y.demandOption(["archive", "feed-url", "feed-name"]),
    addFeed)
  .command(
    "update",
    "update tracked podcasts and download new episodes",
    (y) => y.demandOption(["archive"]),
    updateFeeds)
  .command(
    "list",
    "list the podcasts that are currently in the archive",
    (y) => y.demandOption(["archive"]),
    listFeeds)
  .help()
  .argv;

function init(opts: any) {
  const archive: string = opts.archive;
  const baseUrl: string = opts["base-url"];
  (async () => {
    const db = await DataBase.create(archive, baseUrl);
    console.log(`Initialized podcast archive under ${archive}`);
  })();
}

function addFeed(opts: any) {
  const archive: string = opts.archive;
  const feedUrl: string = opts["feed-url"];
  const feedName: string = opts["feed-name"];
  (async () => {
    const db = await DataBase.load(archive);
    try {
      await db.newFeed(feedName, feedUrl);
      console.log(`Added podcast ${feedName} to archive.`);
    } catch (e) {
      console.log(`Unable to add podcast`, e);
    }
  })();
}

function updateFeeds(opts: any) {
  const archive: string = opts.archive;
  const justMp3s: boolean = !!opts["just-mp3"];
  (async () => {
    const db = await DataBase.load(archive);
    try {
      const feeds = await db.feeds();
      await Promise.all(feeds.map(async (feed) => {
        console.log(`Updating ${feed.name}.`);
        try {
          await feed.update(justMp3s);
        } catch (e) {
          console.log(`Error encountered updating ${feed.name}:`, e);
        }
      }));
      console.log(`Finished updating feeds.`);
    } catch (e) {
      console.log(`Error encountered updating feeds:`, e);
    }
    try {
      db.updateHtml();
    } catch (e) {
      console.log(`Error encountered generating HTML:`, e);
    }
  })();
}

function listFeeds(opts: any) {
  const archive: string = opts.archive;
  (async () => {
    const db = await DataBase.load(archive);
    const feeds = await db.feeds();
    for (const feed of feeds) {
      try {
        const channel = await feed.channel();
        console.log(`${feed.name}`);
        console.log(`\tTracked RSS: ${feed.url}`);
        console.log(`\tLocal RSS: ${feed.localUrl}`);
        console.log(`\tEpisodes: ${channel.items.length}`);
      } catch (e) {
        console.log(`Unable to list ${feed.name}:`, e);
      }
    }
  })();
}
