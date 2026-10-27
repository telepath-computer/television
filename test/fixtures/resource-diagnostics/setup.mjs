export default function setup() {
  if (process.env.RESOURCE_FIXTURE_MODE === "exit") process.exit(17);
}
