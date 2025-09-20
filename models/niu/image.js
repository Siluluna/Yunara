export class NiuImage {
  constructor(imageData) {
    this.path = imageData.path?.replace(/\\/g, "/") || ''
    this.storagebox = imageData.storagebox || ''
    this.characterName = imageData.characterName
    this.sourceGallery = imageData.sourceGallery
    this.attributes = imageData.attributes || {}
  }

  isPurified(purificationLevel = 0) {
    if (purificationLevel <= 0) {
      return false
    }
    const isRx18 = this.attributes.isRx18 === true
    const isPx18 = this.attributes.isPx18 === true
    if (purificationLevel === 1 && isRx18) {
      return true
    }
    if (purificationLevel >= 2 && (isRx18 || isPx18)) {
      return true
    }
    return false
  }

  isFilteredBy(filterSettings = {}) {
    if (filterSettings.Ai === false && this.attributes.isAiImage === true) {
      return true
    }
    if (filterSettings.EasterEgg === false && this.attributes.isEasterEgg === true) {
      return true
    }
    if (filterSettings.Layout === false && this.attributes.layout === "fullscreen") {
      return true
    }
    return false
  }


  isBanned(niu_userBansSet = new Set()) {
    if (this.attributes.isBan === true) {
      return true
    }
    if (niu_userBansSet.has(this.path)) {
      return true
    }
    return false
  }


  isAllowed(settings = {}, niu_userBansSet = new Set()) {
    if (this.isBanned(niu_userBansSet)) {
      return false
    }
    if (this.isPurified(settings.PurificationLevel)) {
      return false
    }
    if (this.isFilteredBy(settings.Filter)) {
      return false
    }
    return true
  }
}
