/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const trips = app.findCollectionByNameOrId("trips");
  
  const taxiRides = new Collection({
    name: "taxi_rides",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
    fields: [
      { name: "messageId", type: "text" },
      { name: "date", type: "text" },
      { name: "time", type: "text" },
      { name: "fromAddress", type: "text" },
      { name: "toAddress", type: "text" },
      { name: "route", type: "text" },
      { name: "amount", type: "number" },
      { name: "paymentType", type: "text" },
      { name: "paymentLabel", type: "text" },
      { name: "isCorporate", type: "bool" },
      { name: "description", type: "text" },
      {
        name: "trip",
        type: "relation",
        collectionId: trips.id,
        cascadeDelete: false,
        maxSelect: 1
      },
      { name: "expenseId", type: "text" },
      { name: "status", type: "text" },
      { name: "deleted", type: "bool" }
    ]
  });
  app.save(taxiRides);

  const expenses = app.findCollectionByNameOrId("expenses");
  try {
    expenses.fields.add(new TextField({ name: "fromAddress" }));
    expenses.fields.add(new TextField({ name: "toAddress" }));
    expenses.fields.add(new TextField({ name: "route" }));
    expenses.fields.add(new TextField({ name: "rideTime" }));
    expenses.fields.add(new TextField({ name: "taxiRideId" }));
    app.save(expenses);
  } catch (_) {}

  return null;
}, (app) => {
  try {
    const col = app.findCollectionByNameOrId("taxi_rides");
    if (col) app.delete(col);
  } catch (_) {}
  return null;
});
