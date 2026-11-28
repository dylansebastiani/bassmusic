/* Payout note and per-show savings estimate for promoters. Needs fees.js (SubductionFees) loaded first.
   Numbers come from the server's read-only paid ticket counts. Nothing here touches Stripe. */
var StackSavings = (function () {
  var DASH = "https://dashboard.stripe.com";
  function usd(c) { return "$" + ((Number(c) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // Sum of (Eventbrite fee - Subduction fee) over each paid ticket at its own face price. Never below zero.
  function keptCents(sales) {
    var by = (sales && sales.by_price) || [], t = 0;
    by.forEach(function (r) { t += (SubductionFees.eventbriteFeeCents(r[0]) - SubductionFees.feeCents(r[0])) * r[1]; });
    return Math.max(0, t);
  }
  function stripeNote() {
    return "Ticket money goes straight to your own Stripe account. Subduction never holds it. " +
      '<a href="' + DASH + '" target="_blank" rel="noopener">Open your Stripe dashboard</a>';
  }
  function line(sales) {
    if (!sales || !sales.count) return '<span class="save none">No sales to compare yet.</span>';
    var n = keptCents(sales);
    return '<span class="save"><b>You kept ' + usd(n) + " vs Eventbrite</b> <em>estimate</em>" +
      "<small>On " + sales.count + (sales.count === 1 ? " paid ticket" : " paid tickets") + " (" + usd(sales.face_cents) + " face value). Your buyers pay the fee, so you keep the full ticket price. This is the estimated fee difference, not a Stripe payout.</small></span>";
  }
  return { stripeNote: stripeNote, line: line, keptCents: keptCents, DASH: DASH };
})();
