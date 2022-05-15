import { Low, JSONFile } from "https://cdn.skypack.dev/lowdb";
import { cron } from "https://deno.land/x/deno_cron/cron.ts";
import { equal } from "https://deno.land/x/equal/mod.ts";
import { Bot } from "https://deno.land/x/grammy/mod.ts";

const fetchData = async () => {
  const result = await fetch(
    "https://www.immobilienscout24.de/Suche/radius/wohnung-mieten?centerofsearchaddress=Hamburg;21033;Am%20Gleisdreieck;;;&geocoordinates=53.49475;10.1329;2.0&enteredFrom=result_list",
    {
      headers: {
        accept: "application/json; charset=utf-8",
        "accept-language": "en-US,en;q=0.9,ja-JP;q=0.8,ja;q=0.7",
        "cache-control": "no-cache",
        "content-type": "application/json; charset=utf-8",
        pragma: "no-cache",
        "sec-ch-ua":
          '" Not A;Brand";v="99", "Chromium";v="101", "Google Chrome";v="101"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
      },
      referrer:
        "https://www.immobilienscout24.de/Suche/radius/wohnung-mieten?centerofsearchaddress=Hamburg%3B21033%3BAm%20Gleisdreieck%3B%3B%3B&geocoordinates=53.49475%3B10.1329%3B2.0",
      referrerPolicy: "strict-origin-when-cross-origin",
      body: null,
      method: "POST",
      mode: "cors",
      credentials: "include",
    }
  );
  const response = await result.json();
  const results = response.searchResponseModel[
    "resultlist.resultlist"
  ].resultlistEntries[0].resultlistEntry.map(
    (entry: any) =>
      ({
        createdAt: entry["@creation"],
        modifiedAt: entry["@modification"],
        publishedAt: entry["@publishDate"],
        id: entry["@id"],
        size: entry.attributes[0].attribute.find(
          (attribute: any) => attribute.label === "Wohnfläche"
        )?.value,
        rent: entry.attributes[0].attribute.find(
          (attribute: any) => attribute.label === "Kaltmiete"
        )?.value,
        rentWarm: new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "EUR",
        }).format(
          entry["resultlist.realEstate"].calculatedTotalRent.totalRent.value
        ),
        title: entry["resultlist.realEstate"].title,
      } as Entry)
  );
  return results;
};

interface Entry {
  createdAt: string;
  modifiedAt: string;
  publishedAt: string;
  id: string;
  size: string;
  rent: string;
  rentWarm: string;
  title: string;
}

const file = "db.json";
const adapter = new JSONFile(file);
const db = new Low(adapter);

await db.read();
db.data ||= { entries: [] };
const bot = new Bot(Deno.env.get("telegram_api_key"));
bot.on("message:text", (ctx) => {
  if (ctx.message.text.includes("/all")) {
    ctx.reply(
      `<b>${db.data.entries.length} Einträge</b>` +
        db.data.entries
          .map((entry: Entry) => {
            return `\n<a href="https://www.immobilienscout24.de/expose/${entry.id}">${entry.title}</a>\n${entry.size} | ${entry.rentWarm} warm`;
          })
          .join("\n"),
      { parse_mode: "HTML" }
    );
  } else if (ctx.message.text.includes("/subscribe")) {
    ctx.reply("Erfolgreich registriert");
    db.data.listeners.push(ctx.chat.id);
    db.write();
  } else if (ctx.message.text.includes("/unsubscribe")) {
    ctx.reply(
      "Erfolgreich abgemeldet. Du erhältst nun keine Nachrichten mehr."
    );
    db.data.listeners = db.data.listeners.filter(
      (listener: number) => listener !== ctx.chat.id
    );
    db.write();
  }
});
bot.start();
cron("0 */5 * * * *", async () => {
  console.log(
    `[${new Date().getHours()}:${new Date().getMinutes()}:${new Date().getSeconds()}]`
  );
  const entries = await fetchData();
  entries.forEach((entry: Entry) => {
    const matchIndex = db.data.entries.findIndex(
      (dbEntry: Entry) => dbEntry.id === entry.id
    );
    if (matchIndex >= 0) {
      if (!equal(db.data.entries[matchIndex], entry)) {
        console.log("Something changed for entry ID:", entry.id);
        db.data.entries[matchIndex] = entry;
        db.data.listeners.forEach((chat: number) => {
          bot.api.sendMessage(
            chat,
            `<b>Eintrag Update</b>\n<a href="https://www.immobilienscout24.de/expose/${entry.id}">${entry.title}</a>\n${entry.size} | ${entry.rentWarm} warm`,
            { parse_mode: "HTML" }
          );
        });
      } else {
        console.log("Found entry but it's unchanged. ID:", entry.id);
      }
    } else {
      console.log("Found new entry. ID:", entry.id);
      db.data.entries.push(entry);
      db.data.listeners.forEach((chat: number) => {
        bot.api.sendMessage(
          chat,
          `<b>Neuer Eintrag</b>\n<a href="https://www.immobilienscout24.de/expose/${entry.id}">${entry.title}</a>\n${entry.size} | ${entry.rentWarm} warm`,
          { parse_mode: "HTML" }
        );
      });
    }
  });
  await db.write();
});
