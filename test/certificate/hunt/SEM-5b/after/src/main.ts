const load = (name: string) => import(`./plugins/${name}`);
load("csv").catch((e: Error) => console.log("FAILED: " + e.message.split("\n")[0]));
