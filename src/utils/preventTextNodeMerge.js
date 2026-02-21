export default async function preventTextNodeMerge(page) {
  /*
        <h3 key={post.id}>{post.title.substring(0, 30)}...</h3> -> A. creates hydration issue
        <h3 key={post.id}>{post.title.substring(0, 30)+"..."}</h3> -> B. No hydration issue

        In case A what happens is that on the server, 
        text nodes are merged but on the client side when react does 
        rendering it creates separate text nodes. This creates a mismatch 
        between server dom and client dom

        To prevent this the following function loops through the text nodes and
        adds an invisible boundary between text nodes preventing the merge on server side

    */

  await page.evaluate(() => {
    function separateAdjacentTextNodes(root) {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
        null,
        false,
      );

      while (walker.nextNode()) {
        const element = walker.currentNode;
        const children = element.childNodes;

        // CRITICAL: We loop backwards (right to left) so that inserting
        // new comment nodes doesn't mess up the index of items we haven't checked yet.
        for (let i = children.length - 1; i > 0; i--) {
          const current = children[i];
          const previous = children[i - 1];

          // Check: Is this a Text Node (Type 3) touching another Text Node?
          if (current.nodeType === 3 && previous.nodeType === 3) {
            // Action: Insert an empty comment between them
            const comment = document.createComment("");
            element.insertBefore(comment, current);
          }
        }
      }
    }

    // Execute the surgery on the entire body
    separateAdjacentTextNodes(document.body);
  });
}
