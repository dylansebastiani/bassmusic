/* Fee calculator. Subduction's line is checkout's totals() for one paid ticket:
   total = ceil((price + 150 + 30) / (1 - 0.029)), with price in cents.
   A $25 ticket comes to $27.61, so the fee is $2.61, the same figure as the homepage.
   Competitor lines are estimates from their published rates, one ticket per order. */
var SubductionFees = (function () {
  var CARD_PCT = 0.029, CARD_FIXED = 30, PLATFORM = 150;

  function checkoutTotal(netCents, paidTickets) {
    if (netCents <= 0 || paidTickets <= 0) return 0;
    var platform = PLATFORM * paidTickets;
    return Math.ceil((netCents + platform + CARD_FIXED) / (1 - CARD_PCT));
  }
  function feeCents(priceCents) {
    if (priceCents <= 0) return 0;
    return checkoutTotal(priceCents, 1) - priceCents;
  }
  // Eventbrite US: 3.7% + $1.79 per paid ticket, then 2.9% of the order including that service fee.
  function eventbriteFeeCents(priceCents) {
    if (priceCents <= 0) return 0;
    var service = Math.round(priceCents * 0.037) + 179;
    return service + Math.round((priceCents + service) * 0.029);
  }
  // Posh: 10% + $0.99 per paid ticket, card processing included.
  function poshFeeCents(priceCents) {
    if (priceCents <= 0) return 0;
    return Math.round(priceCents * 0.10) + 99;
  }
  // DICE US self sign-up: 13% of face value, card processing included.
  function diceFeeCents(priceCents) {
    if (priceCents <= 0) return 0;
    return Math.round(priceCents * 0.13);
  }

  function quote(priceCents, count) {
    var sub = feeCents(priceCents);
    var rows = [
      { key: "eb", name: "Eventbrite", estimate: true, fee: eventbriteFeeCents(priceCents) },
      { key: "posh", name: "Posh", estimate: true, fee: poshFeeCents(priceCents) },
      { key: "dice", name: "DICE", estimate: true, fee: diceFeeCents(priceCents) },
      { key: "us", name: "Subduction", estimate: false, fee: sub }
    ];
    return {
      priceCents: priceCents,
      count: count,
      subFee: sub,
      subBuyer: priceCents + sub,
      cardCents: priceCents > 0 ? sub - PLATFORM : 0,
      rows: rows,
      keepCents: priceCents * count,
      feesCents: sub * count
    };
  }

  return {
    checkoutTotal: checkoutTotal,
    feeCents: feeCents,
    eventbriteFeeCents: eventbriteFeeCents,
    poshFeeCents: poshFeeCents,
    diceFeeCents: diceFeeCents,
    quote: quote
  };
})();

(function () {
  if (typeof document === "undefined") return;
  var $ = function (id) { return document.getElementById(id); };
  var priceEl = $("price"), countEl = $("count");
  if (!priceEl || !countEl) return;

  function money(cents) {
    return (cents < 0 ? "-" : "") + "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dollarsToCents(raw) {
    var s = String(raw == null ? "" : raw).replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n) || n > 10000) return null;
    return Math.round(n * 100);
  }
  function countOf(raw) {
    var s = String(raw == null ? "" : raw).replace(/[,\s]/g, "");
    if (!/^\d+$/.test(s)) return null;
    var n = Number(s);
    if (n < 1 || n > 1000000) return null;
    return n;
  }

  function draw() {
    var price = dollarsToCents(priceEl.value), count = countOf(countEl.value);
    var note = $("note"), bars = $("bars"), show = $("show");
    if (price == null || count == null) {
      note.textContent = "Enter a ticket price and a ticket count.";
      bars.hidden = true;
      show.hidden = true;
      return;
    }
    var q = SubductionFees.quote(price, count);
    var max = 0;
    q.rows.forEach(function (r) { if (r.fee > max) max = r.fee; });
    if (price === 0) {
      note.textContent = "Free tickets stay free. Buyers pay $0.00 and you keep $0.00.";
    } else {
      note.textContent = "Buyer pays " + money(q.subBuyer) + " on Subduction for one ticket. You keep " + money(price) + ". That " + money(q.subFee) + " is the $1.50 fee plus " + money(q.cardCents) + " card processing.";
    }
    $("barsH").textContent = "Fees on a " + money(price) + " ticket";
    bars.hidden = false;
    bars.querySelectorAll("[data-row]").forEach(function (row) {
      var key = row.getAttribute("data-row");
      var r = q.rows.filter(function (x) { return x.key === key; })[0];
      var pct = max > 0 ? Math.max(2, Math.round(r.fee / max * 100)) : 0;
      row.querySelector(".track b").style.width = (r.fee === 0 ? 0 : pct) + "%";
      row.querySelector(".amt").textContent = money(r.fee);
      row.querySelector(".buyer").textContent = money(price + r.fee);
    });
    show.hidden = false;
    $("keep").textContent = "On " + count.toLocaleString("en-US") + " tickets, you keep " + money(q.keepCents) + ".";
    $("bulk").textContent = "Buyers pay " + money(q.feesCents) + " in fees on Subduction. The estimates for those same tickets are " + money(q.rows[0].fee * count) + " on Eventbrite, " + money(q.rows[1].fee * count) + " on Posh and " + money(q.rows[2].fee * count) + " on DICE.";
  }

  priceEl.addEventListener("input", draw);
  countEl.addEventListener("input", draw);
  draw();
})();
