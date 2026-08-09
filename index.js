import { Browser, FormData } from "happy-dom";
import { TZDate } from "@date-fns/tz";
import { addMinutes, formatISO } from "date-fns";
import ical from "ical-generator";
import fs from "node:fs";

const timezone = "Europe/London";

function parseRuntime(runtime) {
  const match = runtime.match(/(?:(?<h>\d+)\s*(?:hr|hrs|hour))?(?:\s*(?<m>\d+)\s*(?:min|mins|minutes))$/);
  if (!match)
    throw Error(`could not parse '${runtime}'`);
  return parseInt(match.groups["h"] || "0") * 60 + parseInt(match.groups["m"] || "0")
}

function parseTime(time) {
  const [_time, h, m, am] = time.match(/(\d{1,2})(?:[:\.](\d{2}))?(am|pm)/);
  const hour = am == "am" ? parseInt(h) % 12 : (parseInt(h) + (h == "12" ? 0 : 12));
  const minute = parseInt(m || '0');
  return [hour, minute];
}

async function fetchDate(browser, date, callback) {
  const page = browser.newPage();
  try {
    await page.goto(`https://www.barbican.org.uk/whats-on/cinema?day=${formatISO(date, {"representation": "date"})}`);
    await page.waitUntilComplete();

    page.mainFrame.document.querySelectorAll(".view--cinema-listings .cinema-listing-card").forEach(listing => {
      const title = listing.querySelector(".cinema-listing-card__content > h2").textContent.trim();
      const description = listing.querySelector(".cinema-listing-card__content > p").textContent.trim();
      let runtime = 90;
      listing.querySelectorAll(".cinema-listing-card__tag").forEach(tag => {
        try {
          runtime = parseRuntime(tag.textContent.trim());
        } catch (e) {
          //
        }
      });
      listing.querySelectorAll(".cinema-instance-list .cinema-instance-list__instance a").forEach(instance => {
        try {
          const [hour, minute] = parseTime(instance.textContent.trim());
          const start = new TZDate(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, timezone);
          const end = addMinutes(start, runtime);
          callback({
            title,
            description,
            start,
            end,
            url: instance.href,
          });
        } catch (err) {
          console.trace(err);
        }
      })
    })
  } finally {
    await page.close();
  }
}

async function main() {
  const days = 30;
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  const calendar = ical({
    name: "Barbican"
  });

  const browser = new Browser({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      navigation: {
        disableChildPageNavigation: true,
        disableChildFrameNavigation: true,
      },
    }
  });

  let promises = [];

  for (let i = 0; i < days; ++i) {
    promises.push((async (i) => {
      const date = new Date(year, month, day + i);
      await fetchDate(browser, date, ({ start, end, title, description, url }) => {
        calendar.createEvent({
          start,
          end,
          timezone,
          url,
          summary: title,
          description,
          location: {
            title: "Barbican",
          }
        })
      });
      console.log(`fetched ${date}`);
    })(i));
  }

  await Promise.all(promises);

  if (calendar.length() == 0)
    throw new Error("Calendar was empty");

  const dest = process.argv[2] || "out.ics";
  fs.writeFile(dest, calendar.toString(), error => {
    if (error) {
      console.error(error);
    } else {
      console.log(`wrote ${calendar.events().length} events to ${dest}`);
    }
  })

  await browser.close();
}

main();
