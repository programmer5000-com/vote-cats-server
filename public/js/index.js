/* global mdc, firebase, dateFns */
mdc.autoInit();

let textField = null;
let characterCounter = null;
let loadedState = null;
let myLikesLock = Promise.resolve([]);
let lastPage = null;

// some browsers scroll you to where you were last
scrollTo(0, 0);

const $ = selector => document.querySelector(selector);

const imageshowcase = $("#imageshowcase");
const imageshowcaseDialog = new mdc.dialog.MDCDialog(imageshowcase);
const imageshowcaseDialogFavButton = new mdc.iconButton.MDCIconButtonToggle(document.querySelector("#imageshowcase .add-to-favorites"));
imageshowcaseDialog.listen("MDCDialog:opened", () => {
	imageshowcaseDialogFavButton.ripple.layout();
});
imageshowcaseDialog.listen("MDCDialog:closing", (e) => {
	if(e.detail.action) history.pushState(lastPage || "/", "", lastPage || "/");
	checkState();
});

const dialog = new mdc.dialog.MDCDialog($("#sign-in-modal"));
dialog.listen("MDCDialog:closed", e => {
	if(e.detail.action === "accept"){
		firebase.auth().signInWithPopup(new firebase.auth["GoogleAuthProvider"]()).then(() => dialog.close());
	}else{
		document.body.blur();
	}
});

const switchToFavsOnly = () => {
	imgs = [];
	myLikesLock.then(() => {
		if(myLikes.length){
			fetchIt(`/api/v1/picts/getalot?${myLikes.reduce((acc, like) => acc + "&ids[]=" + like, "").slice(1)}`).then(x=>x.json()).then(data => {
				imgs = data;
				myLikes - data.map(img => img.timeStamp);
				data.forEach(img => addPict(img));
			});
		}
	});
};
const switchToAllPicts = () => {
	imgs = [];
	addImgs(7 * calcNumColumns(innerWidth));
};

// if if we've ran out of content
let noMore = false;
// the snackbar to tell us we've ran out of content
const thatsIt = new mdc.snackbar.MDCSnackbar($(".thats-it"));
let thatsItTimeout;

const calcPixelsLeft = () => getRealHeightOfHighestColumn() - (document.documentElement.scrollTop + innerHeight);

customElements.define("masonry-panel", class extends HTMLElement {
	constructor() {
		super();
		let template = document.getElementById("panel-template").content;
		this.attachShadow({mode: "open"}).appendChild(template.cloneNode(true));
	}
});

const fetchIt = async (url, options = {}, allowNoAuth = true) => {
	const currentUser = firebase.auth().currentUser;
	if(currentUser){
		const token = await currentUser.getIdToken();
		if(!options.headers) options.headers = {};
		options.headers.authorization = "Bearer " + token;
		return fetch(url, options);
	}else if(allowNoAuth){// if it's ok to make the request when signed out
		return fetch(url, options);
	}else{
		throw new Error("Not signed in!");
	}
};

const addComment = (comment, pictId) => {
	const div = document.createElement("div");
	div.classList.add("comment");
	div.setAttribute("data-uid", comment.uid);
	div.setAttribute("data-id", comment.id);
	if(comment.isDeleted) div.classList.add("deleted");

	const img = document.createElement("img");
	img.classList.add("profile-pict");
	img.setAttribute("src", comment.picture);

	const userName = document.createElement("span");
	userName.classList.add("mdc-typography--overline");
	userName.classList.add("user-name");
	userName.innerText = comment.username;

	const text = document.createElement("span");
	text.classList.add("comment-text");
	text.innerText = comment.content;

	const deleteBtn = document.createElement("button");
	deleteBtn.classList.add("material-icons");
	deleteBtn.classList.add("mdc-icon-button");
	deleteBtn.classList.add("mdc-card__action");
	deleteBtn.classList.add("mdc-card__action--icon");
	deleteBtn.classList.add("delete-comment");
	deleteBtn.setAttribute("title", "delete");
	deleteBtn.innerText = "delete";
	if(!firebase.auth().currentUser || (comment.uid !== firebase.auth().currentUser.uid && !isAdmin) || (isAdmin && comment.isDeleted)){
		deleteBtn.setAttribute("hidden", "hidden");
	}

	div.appendChild(img);
	div.appendChild(userName);
	div.appendChild(text);
	div.appendChild(deleteBtn);

	imageshowcase.querySelector("#comments").appendChild(div);
	deleteBtn.onclick = () => {
		fetchIt("/api/v1/picts/" + pictId + "/comment/" + encodeURIComponent(comment.id), {method: "DELETE"}).then(x=>{
			if(x.ok) return;
			throw new Error(x.statusText);
		}).then(() => {
			div.remove();
		});
	};
};

let commentWait = false;
const showcaseImage = id => {
	fetchIt(`/api/v1/picts/${id}`).then(x=>{
		if(x.ok){
			return x.json();
		}
		throw new Error(x);
	}).then(img => {
		imageshowcase.querySelector("img").setAttribute("src", img.url);
		const abbr = imageshowcase.querySelector("abbr");
		const imgDate = new Date(img.timeStamp);
		abbr.setAttribute("title", imgDate.toLocaleString());
		abbr.innerText = dateFns.distanceInWordsToNow(imgDate, {addSuffix: true, includeSeconds: true});

		procDeleteButton(imageshowcase.querySelector(".delete"), img.timeStamp);

		const favButton = imageshowcase.querySelector(".add-to-favorites");
		procFavButton(favButton, imageshowcaseDialogFavButton, img.id, imageshowcase.querySelector(".num-likes"));

		imageshowcase.setAttribute("data-id", img.id);

		imageshowcase.querySelector(".num-likes").innerText = img.numUsersVoted;

		imageshowcase.mdcFavButton = imageshowcaseDialogFavButton;


		if(textField && textField.destroy) textField.destroy(); // this might prevent a memory leak
		textField = new mdc.textField.MDCTextField($(".mdc-text-field"));
		const commentArea = $("#textarea");
		commentArea.onkeypress = e => {
			if(e.key === "Enter"){
				e.preventDefault();
				fetchIt("/api/v1/picts/" + img.id + "/comment?content=" + encodeURIComponent(commentArea.value), {method: "PUT"}).then(x=>{
					if(x.ok) return x.json();
					throw new Error(x.statusText);
				}).then(obj => {
					addComment(obj, img.id);
					commentArea.value = "";
				});
				return false;
			}
		};
		commentArea.onfocus = () => {
			if(!firebase.auth().currentUser){
				if(commentWait){
					commentArea.blur();
					commentWait = false;
				}else {
					$("#fav-dialog-title").innerText = "You need to be signed in to comment on a picture";
					dialog.open();
					commentWait = true;
				}
			}
		};

		if(characterCounter && characterCounter.destroy) characterCounter.destroy(); // this might prevent a memory leak
		characterCounter = new mdc.textField.MDCTextFieldCharacterCounter($(".mdc-text-field-character-counter"));

		if(img.comments && img.comments.length){
			img.comments.forEach(comment => addComment(comment, img.id));
		}

		imageshowcaseDialog.open();
		updateLikes();
	});
};

const getRealHeightOfHighestColumn = () => {
	return getShortestColumn().offsetHeight;
};

const getShortestColumn = () => {
	// get all columns
	const columns = document.querySelectorAll(".masonry-layout-column");
	// and return the shortest one
	// columns don't show their real height, we have to sum the height of their children
	return Array.from(columns).map(column=>{
		column.realHeight = Array.from(column.children).map(child => child.offsetHeight).reduce((a, b)=>a + b, 0);
		return column;
	}).sort((a, b) => a.realHeight - b.realHeight)[0];
};

let isAdmin = false;
const disableAdmin = () => {
	isAdmin = false;
	document.body.classList.remove("admin");
};
const enableAdmin = () => {
	isAdmin = true;
	document.body.classList.add("admin");
};

disableAdmin();

const updateAdmin = () => {
	disableAdmin();
	fetchIt("/api/v1/admin/test").then(res => {
		if(res.ok){
			enableAdmin();
		}
	});
};

let lastId = null;

let imgs = [];
let myLikes = [];

const updateLikes = () => {
	document.querySelectorAll("[data-id]").forEach(x=>{
		if(x.mdcFavButton) x.mdcFavButton.on = false;
	});
	myLikes.forEach(like => {
		const elems = document.querySelectorAll(`[data-id="${like}"]`);
		elems.forEach(elem => elem.mdcFavButton.on = true);
	});
};

const procFavButton = (favButton, mdcFavButton, id, counter) => {
	favButton.addEventListener("MDCIconButtonToggle:change", e => {
		fetchIt(`/api/v1/picts/${id}/${e.detail.isOn ? "" : "un"}favorite`, {
			method: "PUT"
		}).then(resp => {
			// if the request failed
			if(resp.status === 403){// if you're not signed in
				dialog.open();
			}else if(!resp.ok && resp.status !== 400){
				console.log("ERROR - resetting button", favButton);
				// put the button back where it was
				mdcFavButton.on = !e.detail.isOn;
			}else{
				let diff = 0;
				if(e.detail.isOn){
					myLikes.push(id);
					diff = 1;// add one
				}else {
					const index = myLikes.indexOf(id);
					if(index > -1) myLikes.splice(index, 1);
					diff = -1;// subtract one
				}
				counter.innerText = parseInt(counter.innerText) + diff;
				updateLikes();
			}
		});
	});
};

const procDeleteButton = (button, id) => button.addEventListener("click", () => {
	fetchIt("/api/v1/admin/picts/delete/" + id).then(resp => {
		// if the request succeded, remove the panel
		if(resp.ok){
			document.querySelectorAll(`mdc-card[data-id="${id}"]`).forEach(elem => elem.remove());
			imageshowcaseDialog.close();
			return;
		}
		throw new Error(resp.statusText);
	});
});

const emptyColumns = () => document.querySelectorAll(".masonry-layout-column").forEach(x=>x.innerHTML="");

const addPict = pict => {
	const panel = document.createElement("div");
	panel.classList.add("mdc-card");
	panel.setAttribute("data-id", pict.id);
	panel.innerHTML = `
	<div class = "mdc-card__media mdc-card__primary-action" tabindex="0"><img src = "${pict.dispUrl || pict.url}"/>
	</div>
	<div class="mdc-card__actions mdc-card__actions--full-bleed">
	<button class="add-to-favorites mdc-icon-button mdc-card__action mdc-card__action--icon"
	aria-label="Add to favorites"
	aria-hidden="true"
	aria-pressed="false">
	<i class="material-icons mdc-icon-button__icon mdc-icon-button__icon--on">favorite</i>
	<i class="material-icons mdc-icon-button__icon">favorite_border</i>
	</button>
	<span class = "mdc-typography--overline num-likes">${pict.numUsersVoted}</span>
	<button class="material-icons mdc-icon-button mdc-card__action mdc-card__action--icon delete" title="Delete">delete</button>
	</div>`;
	// add the panel
	getShortestColumn().appendChild(panel);

	new mdc.ripple.MDCRipple(panel.querySelector(".mdc-card__primary-action"));

	// initalize the button
	const favButton = panel.querySelector("button");
	(new mdc.ripple.MDCRipple(favButton)).unbounded = true;
	const mdcFavButton = new mdc.iconButton.MDCIconButtonToggle(favButton);
	panel.mdcFavButton = mdcFavButton;

	panel.querySelector(".mdc-card__primary-action").onclick = () => {
		history.pushState("/pict/" + pict.id, "", "/pict/" + pict.id);
		checkState();
	};

	// when the button is cliked
	procFavButton(favButton, mdcFavButton, pict.id, panel.querySelector(".num-likes"));

	procDeleteButton(panel.querySelector(".delete"), pict.id);
	// console.log("\t" + pict.timeStamp);
	lastId = new Date(pict.date);
	updateLikes();
};

const addImgs = num => {
	let params = "";
	if(lastId){
		params = "&startAfter=" + lastId.toISOString();
	}
	const url = "/api/v1/picts/get?limit=" + num + params;
	// console.log(url);
	return fetchIt(url).then(x=>x.json()).then(data => {
		// if we didn't get anything, tell the user
		if(!data.length) noMore = true;
		else noMore = false;

		data.forEach(pict=>pict.date = Date.parse(pict.timeStamp));
		data = data.sort((a, b) => b.date - a.date);


		imgs = imgs.concat(data);
		data.forEach(addPict);
		// console.log(lastId, num);
	}).catch(() => {
		isLoading = false;
	});
};

let isLoading = false;
onscroll = () => {
	if(!isLoading && !noMore){
		const pixels = calcPixelsLeft();
		if(pixels < 400){
			isLoading = true;
			addImgs(20).then(() => isLoading = false);
			// console.log(pixels);
		}
	}

	// if we've reached the end and we can't load more content
	if(noMore && document.documentElement.scrollHeight - innerHeight - document.documentElement.scrollTop < 400){
		thatsIt.open();
		if(thatsItTimeout !== undefined){
			clearTimeout(thatsItTimeout);
		}
		thatsItTimeout = setTimeout(() => thatsIt.close(), 3000);
	}
};

let hasLoaded = false;
firebase.auth().onAuthStateChanged(function(user) {
	if(!hasLoaded){
		hasLoaded = true;
		checkState();
	}
	if (user) {
		myLikesLock = fetchIt("/api/v1/mylikes").then(x=>{
			if(x.ok) return x.json();
			throw new Error(x.statusText);
		}).then(likes => {
			myLikes = likes;
			updateLikes();
		});

		fetchIt("/api/v1/auth/profile").then(x=>x.json()).then(data => {
			updateDarkTheme(data.darkTheme || false);
			darkTheme.checked = data.darkTheme;
		});


		// User is signed in.thats-it
		var displayName = user.displayName;
		var email = user.email;
		var emailVerified = user.emailVerified;
		var photoURL = user.photoURL;
		var isAnonymous = user.isAnonymous;
		var uid = user.uid;
		var providerData = user.providerData;

		console.log("SIGNED IN", {displayName, email, emailVerified, photoURL, isAnonymous, uid, providerData});

		$("#signed-out").classList.add("hidden");
		$("#signed-in").classList.remove("hidden");

		const text = $("#profile").querySelector("span");
		text.innerText = displayName;

		const img = $("#profile").querySelector("img");
		img.src = user.photoURL;
		updateAdmin();
	} else {
		// User is signed out.
		console.log("SIGNED OUT");
		$("#signed-out").classList.remove("hidden");
		$("#signed-in").classList.add("hidden");
		disableAdmin();
	}
});

const updateDarkTheme = isDark => isDark ? document.documentElement.classList.add("dark") : document.documentElement.classList.remove("dark");

const signInMenu = new mdc.menu.MDCMenu($("#sign-in-menu"));

const menu = new mdc.menu.MDCMenu($("#settings"));
const darkTheme = new mdc.switchControl.MDCSwitch($("#dark-theme"));
const darkThemeLabel = $("#dark-theme-label");

darkThemeLabel.onclick = () => {
	darkTheme.checked = !darkTheme.checked;
	setDarkTheme();
};

const setDarkTheme = () => {
	fetchIt("/api/v1/auth/profile", {method: "PATCH", body: JSON.stringify({darkTheme: darkTheme.checked})}).then(resp => {
		if(!resp.ok) throw new Error(resp.statusText);
		updateDarkTheme(darkTheme.checked);
	}).catch(() => {
		darkTheme.checked = !darkTheme.checked;
	});
};
darkTheme.listen("change", setDarkTheme);

$("#profile").onclick = () => {
	menu.open = !menu.open;
};
$("#sign-in-or-sign-up").onclick = () => {
	signInMenu.open = !signInMenu.open;
};

$("button#sign-out").onclick = () => firebase.auth().signOut();
document.querySelectorAll(".sign-in").forEach(button => button.onclick = () => {
	firebase.auth().signInWithPopup(new firebase.auth[button.dataset.authName + "AuthProvider"]());
});

let currentColumns = 5;
let pastColumns = currentColumns;
// the width when a column is removed
const widthBreakpoints = [400, 675, 900, 1125, 1250, 1425];

// calculate the amount of columns we will need given a display width
const calcNumColumns = (width) => {
	let num = 1;
	widthBreakpoints.forEach((breakpoint, idx) => {
		// if we're in the right range
		if(width >= breakpoint && (width < widthBreakpoints[idx + 1] || widthBreakpoints.length === idx + 1)){
			// return the num
			num = idx + 2;
		}
	});
	return num;
};

const reflowImgs = () => {
	const parent = $(".masonry-layout");

	// empty it
	while (parent.hasChildNodes()) {
		parent.removeChild(parent.lastChild);
	}

	for(let i = 0; i < currentColumns; i ++){
		const div = document.createElement("div");
		div.classList.add("masonry-layout-column");
		parent.appendChild(div);
	}

	imgs.forEach(addPict);
};

const updateColumns = () => {
	pastColumns = currentColumns;
	currentColumns = calcNumColumns(innerWidth);
	if(currentColumns !== pastColumns){
		console.log("going from", pastColumns, "to", currentColumns);
		reflowImgs();
	}
};

onresize = () => updateColumns();
updateColumns();

onpopstate = () => checkState();

const emptyComments = () => imageshowcase.querySelector("#comments").innerHTML = "";

const checkState = () => {
	imgs = [];
	lastId = null;
	lastPage = loadedState;
	// console.log("loadedState vs location.pathname", loadedState, location.pathname);
	if(loadedState !== location.pathname && hasLoaded){
		// console.log("loading", location.pathname);
		loadedState = location.pathname;
		emptyComments();

		imageshowcaseDialog.close();

		setTimeout(() => {
			if(location.pathname === "/"){
				emptyColumns();
				document.title = "Home - Vote Cats";
				switchToAllPicts();
			}else if(location.pathname === "/favs"){
				emptyColumns();
				document.title = "My Favorites - Vote Cats";
				switchToFavsOnly();
			}else if(location.pathname.startsWith("/pict/")){
				document.title = "A Picture - Vote Cats";
				showcaseImage(location.pathname.slice(6));
			}else{
				// basic 404 handling
				location.href = "/";
			}
			$("#loading").hidden = true;
		}, 0);
	}
};

//history.pushState(null, "", "/")

document.querySelectorAll("[data-spa]").forEach(link => link.onclick = e => {
	history.pushState(link.getAttribute("href"), "", link.getAttribute("href"));
	checkState();
	e.preventDefault();
	return false;
});
