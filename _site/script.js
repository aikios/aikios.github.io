function slowBanners(classname) {
  var tapes = document.getElementsByClassName(classname);
  for (var i = 0; i < tapes.length; i++) {
    tapes.item(i).style.animationDuration = "75s";
  }
}
setTimeout(slowBanners, 1000, "marquee-content-right1");
setTimeout(slowBanners, 1500, "marquee-content-left1");
setTimeout(slowBanners, 1700, "marquee-content-left2");
setTimeout(slowBanners, 1900, "marquee-content-right2");