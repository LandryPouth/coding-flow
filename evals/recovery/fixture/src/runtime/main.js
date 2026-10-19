function main(argv) {
  const runId = argv[2];

  if (!/^[0-9a-f-]{36}$/.test(runId || "")) {
    console.error("expected a run UUID, not code");
    process.exit(2);
  }

  console.log("run", runId);
}

main(process.argv);
